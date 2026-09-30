// THE SEC ARCHIVE, LAYER 1 (#552 COWORK #65 PR 1), run and mutated.
//   1. SigV4 reproduces AWS's published example signature exactly (the
//      "GET Object" example: examplebucket, test.txt, Range bytes=0-9).
//      MUTATION: signed headers left unsorted → a different signature.
//   2. Nothing is dropped: companyfacts → rows → companyfacts round-trips every
//      fact of every taxonomy, and the encoded object decodes to the same rows.
//      MUTATION: one taxonomy skipped in the normaliser → caught.
//   3. The backfill loop, driven with stubs: paced, resumable, an unchanged
//      re-fetch writes nothing, SEC 429/403 STOPS the run with the index saved
//      (#552 COWORK #67), a 5xx is retried once. MUTATION: continuing after a
//      429 → caught. Logs carry counts only.
//   4. One runner, credentials only from the workflow's secrets, Upstash and
//      R2 isolated in both directions, no Redis.
//
//   node scripts/check-sec-archive.mjs
import fs from "node:fs";
import * as A from "../lib/secArchive.mjs";
import { readCodeOnly } from "./lib/source-code.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

console.log("\n1. SigV4 against AWS's published example");
const EMPTY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const EX = { method: "GET", host: "examplebucket.s3.amazonaws.com", path: "/test.txt", headers: { Range: "bytes=0-9" },
  payloadHash: EMPTY, accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  region: "us-east-1", amzDate: "20130524T000000Z" };
const sig = A.signV4(EX);
check("signature f0e8bdb8…bdb41, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date",
  sig.signature === "f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41" && /SignedHeaders=host;range;x-amz-content-sha256;x-amz-date,/.test(sig.headers.authorization), sig.signature);
{
  const SRC = fs.readFileSync("lib/secArchive.mjs", "utf8");
  const ANCHOR = "const names = Object.keys(all).sort();";
  if (SRC.split(ANCHOR).length !== 2) throw new Error("sigv4 mutation anchor must match once");
  const tmp = `lib/.check-sec-archive-${process.pid}.mjs`;
  fs.writeFileSync(tmp, SRC.replace(ANCHOR, "const names = Object.keys(all);"));
  let M;
  try { M = await import(`../${tmp}`); } finally { fs.rmSync(tmp, { force: true }); }
  check("MUTATION: headers not sorted → the signature no longer matches (caught)", M.signV4(EX).signature !== sig.signature);
}

console.log("\n2. nothing dropped: rows round-trip every fact");
const CF = {
  cik: 320193, entityName: "Example Inc.",
  facts: {
    dei: { EntityCommonStockSharesOutstanding: { label: "Shares", description: "d", units: { shares: [{ end: "2026-07-17", val: 14.8e9, accn: "0000320193-26-000070", fy: 2026, fp: "Q3", form: "10-Q", filed: "2026-08-01", frame: "CY2026Q2I" }] } } },
    "us-gaap": {
      Revenues: { label: "Revenues", description: "r", units: { USD: [
        { start: "2025-09-28", end: "2026-06-27", val: 1, accn: "0000320193-26-000070", fy: 2026, fp: "Q3", form: "10-Q", filed: "2026-08-01" },
        { start: "2025-09-28", end: "2026-06-27", val: 2, accn: "0000320193-26-000090", fy: 2026, fp: "Q3", form: "10-Q/A", filed: "2026-09-01", frame: "CY2026Q2" }] } },
      LiabilitiesAndStockholdersEquity: { label: "L&SE", description: null, units: { USD: [{ end: "2026-06-27", val: 3, accn: "0000320193-26-000070", fy: 2026, fp: "Q3", form: "10-Q", filed: "2026-08-01" }] } },
    },
    "ifrs-full": { Revenue: { label: "Revenue", description: "i", units: { EUR: [{ start: "2025-01-01", end: "2025-12-31", val: 4, accn: "0000000000-26-000001", fy: 2025, fp: "FY", form: "20-F", filed: "2026-03-01" }] } } },
    custom: { WidgetsShipped: { label: "Widgets", description: "c", units: { pure: [{ start: "2025-01-01", end: "2025-12-31", val: 5, accn: "0000000000-26-000001", fy: 2025, fp: "FY", form: "20-F", filed: "2026-03-01" }] } } },
  },
};
const norm = (cf) => JSON.stringify(Object.fromEntries(Object.entries(cf.facts).sort().map(([t, cs]) => [t, Object.fromEntries(Object.entries(cs).sort().map(([c, d]) => [c,
  { label: d.label, description: d.description, units: Object.fromEntries(Object.entries(d.units).map(([u, fs]) => [u, fs.map((f) => Object.fromEntries(Object.entries(f).sort()))])) }]))])));
const archived = A.factsToRows(CF);
check("every fact of every taxonomy (dei, us-gaap, ifrs-full, custom) becomes a row: 6 rows, the amended Revenues kept beside the original", archived.rows.length === 6 && archived.rows.filter((r) => r[1] === "Revenues").length === 2);
check("rows → companyfacts reproduces the payload exactly (labels, units, start/frame only where filed)", norm(A.rowsToFacts(archived.header, archived.rows)) === norm(CF));
const dec = A.decodeFacts(A.encodeFacts(archived));
check("the stored object (brotli NDJSON) decodes to the same header and rows", JSON.stringify(dec) === JSON.stringify(archived));
check("newest filing = the 10-Q/A filed 2026-09-01", A.newestFiling(archived.rows)?.accn === "0000320193-26-000090");
{
  const SRC = fs.readFileSync("lib/secArchive.mjs", "utf8");
  const ANCHOR = "for (const [taxonomy, concepts] of Object.entries(companyfacts?.facts ?? {})) {";
  if (SRC.split(ANCHOR).length !== 2) throw new Error("normaliser mutation anchor must match once");
  const tmp = `lib/.check-sec-archive-n-${process.pid}.mjs`;
  fs.writeFileSync(tmp, SRC.replace(ANCHOR, `${ANCHOR}\n    if (taxonomy === "custom") continue;`));
  let M;
  try { M = await import(`../${tmp}`); } finally { fs.rmSync(tmp, { force: true }); }
  const m = M.factsToRows(CF);
  check("MUTATION: a taxonomy skipped (the old 'cut to our list' shape) → round-trip fails (caught)", norm(M.rowsToFacts(m.header, m.rows)) !== norm(CF));
}

console.log("\n3. the backfill loop, driven with stubs (lib/secArchiveBackfill.mjs)");
const B = await import("../lib/secArchiveBackfill.mjs");
// A fake SEC: companyfacts and submissions for each CIK, status chosen per
// request number; a fake R2 in memory; a fake clock the sleeps advance.
const harness = (Bmod, statusFor = () => 200) => {
  let n = 0, t = 0;
  const store = new Map(), urls = [], logs = [], sleeps = [], times = [];
  const fetchImpl = async (url) => {
    n++; urls.push(url); times.push(t);
    const status = statusFor(n, url);
    const body = /companyfacts/.test(url) ? JSON.stringify(CF) : JSON.stringify({ cik: "1", filings: { recent: {}, files: [] } });
    return { status, ok: status >= 200 && status < 300, arrayBuffer: async () => new TextEncoder().encode(body).buffer };
  };
  const r2 = { get: async (k) => store.get(k) ?? null, put: async (k, b) => { store.set(k, Buffer.from(b)); } };
  const run = (opts = {}) => Bmod.runBackfill({ universe: ["0000000001", "0000000002", "0000000003", "0000000004"], r2, fetchImpl,
    sleep: async (ms) => { sleeps.push(ms); t += ms; }, now: () => t, log: (l) => logs.push(l), userAgent: "test", checkpoint: 50, ...opts });
  return { run, store, urls, logs, sleeps, times, requests: () => n };
};
{
  const h = harness(B);
  const r = await h.run();
  const idx = JSON.parse(h.store.get("index.json"));
  check("complete run: 4 CIKs archived, 2 SEC requests each, objects and index written",
    r.status === "complete" && r.T.archived === 4 && h.requests() === 8 && h.store.has("facts/0000000001.ndjson.br") && Object.keys(idx.entries).length === 4);
  check("paced at ≤8 requests/s: every gap between SEC requests is ≥125 ms on the clock", B.MIN_GAP_MS === 125 && h.times.slice(1).every((t, i) => t - h.times[i] >= 125), h.times.join(","));
  const again = await h.run();
  check("resumable: a second run finds nothing to do and makes 0 SEC requests", again.T.archived === 0 && h.requests() === 8);
  const puts = [...h.store.keys()].length;
  const refreshed = await h.run({ refresh: true });
  check("REFRESH with unchanged content writes no object, only the index (content hash, COWORK #66)",
    refreshed.T.unchanged === 4 && refreshed.T.puts === 1 && [...h.store.keys()].length === puts);
}
{
  // SEC THROTTLES ON THE 3RD REQUEST (#552 COWORK #67).
  const h = harness(B, (n) => (n === 3 ? 429 : 200));
  const r = await h.run();
  const idx = JSON.parse(h.store.get("index.json") ?? "{}");
  check("429 on the 3rd request → the run stops: status throttled, no request after it, index saved with the 1 CIK done",
    r.status === "throttled" && h.requests() === 3 && Object.keys(idx.entries ?? {}).length === 1 && h.logs.some((l) => /^stopped: SEC throttled/.test(l)), `requests ${h.requests()}`);
  const h403 = harness(B, (n) => (n === 1 ? 403 : 200));
  const r403 = await h403.run();
  check("403 is throttling too: stops after 1 request, nothing archived, index saved", r403.status === "throttled" && h403.requests() === 1 && h403.store.has("index.json"));
  const resumed = harness(B, (n) => (n === 3 ? 429 : 200));
  await resumed.run();
  const resume = await resumed.run();
  check("the next dispatch resumes: the remaining 3 CIKs are archived", resume.status === "complete" && resume.T.archived === 3);
}
{
  // 5xx: retried once after 10 s; a second 5xx fails that CIK and the run continues.
  const once = harness(B, (n) => (n === 1 ? 503 : 200));
  const r1 = await once.run();
  check("one 503 → retried after 10 s, the CIK archived, run complete", r1.status === "complete" && r1.T.archived === 4 && r1.T.failed === 0 && once.sleeps.includes(B.RETRY_AFTER_MS));
  const twice = harness(B, (n) => (n === 1 || n === 2 ? 503 : 200));
  const r2 = await twice.run();
  check("two 503s on one request → that CIK counted failed, the run continues to the rest", r2.status === "complete" && r2.T.failed === 1 && r2.T.archived === 3);
}
{
  const SRC = fs.readFileSync("lib/secArchiveBackfill.mjs", "utf8");
  const ANCHOR = 'if (e instanceof SecThrottled) { status = "throttled"; break; }';
  if (SRC.split(ANCHOR).length !== 2) throw new Error("throttle mutation anchor must match once");
  const tmp = `lib/.check-sec-archive-b-${process.pid}.mjs`;
  fs.writeFileSync(tmp, SRC.replace(ANCHOR, "/* continue after a 429 */"));
  let M;
  try { M = await import(`../${tmp}`); } finally { fs.rmSync(tmp, { force: true }); }
  const h = harness(M, (n) => (n === 3 ? 429 : 200));
  const r = await h.run();
  check("MUTATION: the run continues after a 429 → it keeps requesting (caught)", r.status !== "throttled" && h.requests() > 3, `requests ${h.requests()}`);
}
{
  const h = harness(B);
  await h.run();
  check("public log lines carry counts and status only: no URL, CIK, value or row", h.logs.length >= 2 && h.logs.every((l) => !/https?:|000000000\d|\[|\bval\b/.test(l)), h.logs.join(" | ").slice(0, 120));
}

console.log("\n3b. the daily incremental job, driven with stubs (lib/secArchiveIncremental.mjs)");
const I = await import("../lib/secArchiveIncremental.mjs");
{
  const IDX = [
    "Description:           Daily Index of EDGAR Dissemination Feed by Form Type",
    "Form Type   Company Name                                                  CIK         Date Filed  File Name",
    "---------------------------------------------------------------------------------------------------------------------------------------------",
    "10-Q        ONE INC                                                       1           20260929    edgar/data/1/0000000001-26-000001.txt",
    "8-K         TWO CORP                                                      2           20260929    edgar/data/2/0000000002-26-000001.txt",
    "10-K        NOT IN UNIVERSE LTD                                           9           20260929    edgar/data/9/0000000009-26-000001.txt",
    "SC 13G/A    ONE INC                                                       1           20260929    edgar/data/1/0000000001-26-000002.txt",
  ].join("\n");
  const rows = I.parseFormIndex(IDX);
  check("form.idx parsed: 4 rows, multi-word forms kept ('SC 13G/A'), CIKs padded", rows.length === 4 && rows[3].form === "SC 13G/A" && rows[0].cik === "0000000001");
  const ch = I.changedCiks(rows, new Set(["0000000001", "0000000002", "0000000003"]));
  check("a 10-Q refreshes facts; an 8-K (or a 13G) is submissions only; a CIK outside the universe is ignored",
    ch.get("0000000001") === true && ch.get("0000000002") === false && !ch.has("0000000009") && ch.size === 2);
  check("pending days skip weekends and stop before today", JSON.stringify(I.pendingDays("2026-09-25", "2026-09-30")) === JSON.stringify(["2026-09-28", "2026-09-29"]));

  // A fake archive (3 CIKs, as the backfill left them) + a fake SEC serving one day's index.
  const incHarness = (Imod, statusFor = () => 200) => {
    let n = 0, t = 0;
    const store = new Map(), urls = [];
    const fetchImpl = async (url) => {
      n++; urls.push(url);
      const status = statusFor(n, url);
      const body = /form\.20260929\.idx/.test(url) ? IDX : /daily-index/.test(url) ? "" : /companyfacts/.test(url) ? JSON.stringify(CF) : JSON.stringify({ cik: "1", filings: { recent: {}, files: [] } });
      const st = /daily-index/.test(url) && !/20260929/.test(url) ? 404 : status;
      return { status: st, ok: st >= 200 && st < 300, arrayBuffer: async () => new TextEncoder().encode(body).buffer };
    };
    const r2 = { get: async (k) => store.get(k) ?? null, put: async (k, b) => { store.set(k, Buffer.from(b)); } };
    const seed = { v: 1, updatedAt: "2026-09-28T13:31:50Z", lastDaily: "2026-09-28", entries: Object.fromEntries(["0000000001", "0000000002", "0000000003"].map((c) => [c, { rows: 6, factsSha: "old", subSha: "old", pages: 0 }])) };
    store.set("index.json", Buffer.from(JSON.stringify(seed)));
    const run = (opts = {}) => Imod.runIncremental({ universe: ["0000000001", "0000000002", "0000000003", "0000000004"], r2, fetchImpl,
      sleep: async (ms) => { t += ms; }, now: () => t, log: () => {}, userAgent: "test", todayIso: "2026-09-30", ...opts });
    return { run, store, urls, requests: () => n };
  };
  const h = incHarness(I);
  const r = await h.run();
  const idx = JSON.parse(h.store.get("index.json"));
  const cf1 = h.urls.filter((u) => /companyfacts\/CIK0000000001/.test(u)).length, cf2 = h.urls.filter((u) => /companyfacts\/CIK0000000002/.test(u)).length;
  check("one day read: CIK 1 facts + submissions, CIK 2 submissions only, CIK 3 untouched, lastDaily → 2026-09-29",
    r.status === "complete" && cf1 === 1 && cf2 === 0 && h.urls.some((u) => /submissions\/CIK0000000002/.test(u)) && !h.urls.some((u) => /CIK0000000003/.test(u)) && idx.lastDaily === "2026-09-29", `${r.status} ${idx.lastDaily}`);
  check("the new universe CIK (4) is archived in full", r.T.newCiks === 1 && Boolean(idx.entries["0000000004"]?.factsSha));
  const again = await h.run();
  check("a second run the same day reads no index and makes 0 SEC requests", again.T.days === 0 && again.T.secRequests === 0);
  const th = incHarness(I, (n, url) => (/submissions\/CIK0000000002/.test(url) ? 429 : 200));
  const rt = await th.run();
  const ti = JSON.parse(th.store.get("index.json"));
  check("429 mid-day → stops, index saved, lastDaily NOT advanced past the unfinished day", rt.status === "throttled" && ti.lastDaily === "2026-09-28" && !th.urls.some((u) => /CIK0000000004/.test(u)));
  const SRC = fs.readFileSync("lib/secArchiveIncremental.mjs", "utf8");
  const ANCHOR = "export const FACT_FORMS = /^(10-K|10-Q|20-F|40-F|10-KT|6-K)(\\/A)?$/;";
  if (SRC.split(ANCHOR).length !== 2) throw new Error("fact-forms mutation anchor must match once");
  const tmp = `lib/.check-sec-archive-i-${process.pid}.mjs`;
  fs.writeFileSync(tmp, SRC.replace(ANCHOR, "export const FACT_FORMS = /^(10-K|20-F)(\\/A)?$/;"));
  let MI;
  try { MI = await import(`../${tmp}`); } finally { fs.rmSync(tmp, { force: true }); }
  const mh = incHarness(MI);
  await mh.run();
  check("MUTATION: 10-Q not treated as a financial form → CIK 1's facts not refreshed (caught)", !mh.urls.some((u) => /companyfacts\/CIK0000000001/.test(u)));
}

console.log("\n3c. the diff run's comparison (lib/secArchiveDiff.mjs)");
{
  const D = await import("../lib/secArchiveDiff.mjs");
  const K = ["revenue", "netIncome", "epsDiluted"];
  const P = (s, e, v) => ({ s, e, fp: null, fy: null, a: null, f: null, v, d: "FFF" });
  const base = { h: "H1", quarters: [P("2026-01-01", "2026-03-31", [10, 2, 0.5]), P("2026-04-01", "2026-06-30", [11, 3, 0.6])], years: [P("2025-01-01", "2025-12-31", [40, 9, 2.1])], instants: [] };
  const clone = (x) => JSON.parse(JSON.stringify(x));
  check("the same set → identical", D.compareSets(base, clone(base), K).verdict === "identical");
  const newer = clone(base); newer.quarters.push(P("2026-07-01", "2026-09-30", [12, 4, 0.7]));
  check("a newer quarter only in the archive → identical-plus-newer (new data, not a disagreement)", D.compareSets(base, newer, K).verdict === "identical-plus-newer");
  const moved = clone(base); moved.quarters[0].v[1] = 2.5;
  const cm = D.compareSets(base, moved, K);
  check("one value moved on a shared period → differs, named by field (netIncome: 1)", cm.verdict === "differs" && cm.fields.netIncome === 1 && Object.keys(cm.fields).length === 1);
  const lost = clone(base); lost.years = [];
  check("a stored period the rebuild lacks → differs (onlyInStored 1)", D.compareSets(base, lost, K).onlyInStored === 1 && D.compareSets(base, lost, K).verdict === "differs");
  const older = clone(base); older.quarters.unshift(P("2025-10-01", "2025-12-31", [9, 1, 0.4]));
  check("an OLDER period only in the rebuild → differs (onlyInRebuilt), not 'newer'", D.compareSets(base, older, K).verdict === "differs" && D.compareSets(base, older, K).onlyInRebuilt === 1);
  check("another field hash → hash-differs, not compared position by position", D.compareSets(base, { ...clone(base), h: "H2" }, K).verdict === "hash-differs");
  check("no companyfacts → rebuilt-empty", D.compareSets(base, null, K).verdict === "rebuilt-empty");
  check("floating noise below 1e-9 relative is not a difference", D.compareSets(base, (() => { const x = clone(base); x.quarters[1].v[2] = 0.6 + 1e-12; return x; })(), K).verdict === "identical");
  const SRC = fs.readFileSync("lib/secArchiveDiff.mjs", "utf8");
  // THE UNMATCHED PERIODS BY DATE (COWORK #71): dates only, never a value.
  const both = clone(base); both.years = []; both.quarters.unshift(P("2025-10-01", "2025-12-31", [9, 1, 0.4])); both.quarters.push(P("2026-07-01", "2026-09-30", [12, 4, 0.7]));
  const ub = D.compareSets(base, both, K).unmatched;
  check("unmatched dates: stored-only year, archive-only older quarter, archive-newer quarter, each named by its dates",
    JSON.stringify(ub) === JSON.stringify({ storedOnly: ["Y 2025-01-01..2025-12-31"], rebuiltOnly: ["Q 2025-10-01..2025-12-31"], newer: ["Q 2026-07-01..2026-09-30"] }), JSON.stringify(ub));
  check("unmatched lists carry no value (no field value of the fixture appears)", !/\b(9|40|12|0\.4|0\.7|2\.1)\b(?![-.\d])/.test(JSON.stringify(ub).replace(/\d{4}-\d{2}-\d{2}/g, "")));
  const inst = { ...clone(base), instants: [{ s: null, e: "2025-12-31", v: [1, 1, 1] }] };
  check("an instant is named by its date alone", D.compareSets(inst, clone(base), K).unmatched.storedOnly[0] === "I 2025-12-31");
  const mutate = (anchor, repl, tag) => {
    if (SRC.split(anchor).length !== 2) throw new Error(`diff mutation anchor must match once: ${tag}`);
    const tmp = `lib/.check-sec-archive-d${tag}-${process.pid}.mjs`;
    fs.writeFileSync(tmp, SRC.replace(anchor, repl));
    return import(`../${tmp}`).finally(() => fs.rmSync(tmp, { force: true }));
  };
  const MD = await mutate("if (!s) { if (r.e > storedNewest) { out.newerInArchive++; out.unmatched.newer.push(dates(g, r)); } else { out.onlyInRebuilt++; out.unmatched.rebuiltOnly.push(dates(g, r)); } continue; }",
    "if (!s) { out.newerInArchive++; out.unmatched.newer.push(dates(g, r)); continue; }", "a");
  check("MUTATION: every rebuild-only period called 'newer' → an older missing period hides (caught)", MD.compareSets(base, older, K).verdict !== "differs");
  const MU = await mutate("out.onlyInStored++; out.unmatched.storedOnly.push(dates(g, p));", "out.onlyInStored++;", "b");
  check("MUTATION: stored-only dates not recorded → the stored-only year is missing from the dates line (caught)", MU.compareSets(base, both, K).unmatched.storedOnly.length === 0);
  check("the diff prints the dates line for differing sets", /unmatched periods on differing sets, dates only/.test(readCodeOnly("scripts/sec-archive-diff.mjs")) && /c\.unmatched/.test(readCodeOnly("scripts/sec-archive-diff.mjs")));
  const DIFF = readCodeOnly("scripts/sec-archive-diff.mjs");
  const cmds = [...DIFF.matchAll(/redis\(\[\s*"([A-Z]+)"/g)].map((m) => m[1]);
  check("the diff issues Redis READS only (SMEMBERS, GET, MGET) and writes nothing to R2",
    cmds.length >= 3 && cmds.every((c) => ["SMEMBERS", "GET", "MGET"].includes(c)) && !/r2\.put|writeFactSet/.test(DIFF), cmds.join(","));
  check("the rebuild goes through the shipped pipeline: rowsToFacts → withPredecessorFacts → extractForSymbol → toStoredSet",
    /rowsToFacts\(/.test(DIFF) && /withPredecessorFacts\(/.test(DIFF) && /toStoredSet\(extractForSymbol\(/.test(DIFF));
}

console.log("\n3d. the archive universe = registrants ∪ stored-set CIKs ∪ predecessors (COWORK #71)");
{
  const U = await import("../lib/secArchiveUniverse.mjs");
  const fx = { registrants: { AAA: { cik: 1 }, BBB: { cik: 2 }, BBBW: { cik: 2 } }, extra: { SPY: "0000884394", SPYW: "884394" }, successors: [{ symbol: "AAA", cik: 1, predecessorCik: 34088 }] };
  const u = U.archiveUniverse(fx);
  check("fixture: registrants, extra and predecessor CIKs, deduplicated, 10 digits, sorted",
    JSON.stringify(u) === JSON.stringify(["0000000001", "0000000002", "0000034088", "0000884394"]), u.join(","));
  const real = U.readArchiveUniverse(fs);
  const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows;
  const EXTRA = JSON.parse(fs.readFileSync("data/sec/archive-extra-ciks.json", "utf8")).rows;
  const SUCC = JSON.parse(fs.readFileSync("data/sec/successor-ciks.json", "utf8")).successors;
  const rs = new Set(real);
  check("the real universe holds every registrant CIK, every stored-set CIK in archive-extra-ciks.json, and every predecessor CIK",
    Object.values(REG).every((r) => rs.has(U.cik10(r.cik))) && Object.values(EXTRA).every((c) => rs.has(U.cik10(c))) && SUCC.every((x) => rs.has(U.cik10(x.predecessorCik))), `${real.length}`);
  check("archive-extra-ciks.json: 10-digit CIKs keyed by symbol (the 85 stored sets outside registrants)",
    Object.values(EXTRA).every((c) => /^\d{10}$/.test(c)) && Object.keys(EXTRA).length >= 85 && EXTRA.SPY === "0000884394", `${Object.keys(EXTRA).length}`);
  check("backfill, incremental and diff all read the universe through readArchiveUniverse (no registrants-only universe left)",
    ["scripts/sec-archive-backfill.mjs", "scripts/sec-archive-incremental.mjs", "scripts/sec-archive-diff.mjs"].every((f) => /readArchiveUniverse\(fs\)/.test(readCodeOnly(f))) &&
    !/const universe = \[\.\.\.new Set\(Object\.values\(REG\)/.test(readCodeOnly("scripts/sec-archive-backfill.mjs") + readCodeOnly("scripts/sec-archive-incremental.mjs")));
  check("the diff names a stored set whose CIK is outside the universe (SYMBOL:CIK), apart from 'not archived yet'",
    /"outside-universe"/.test(readCodeOnly("scripts/sec-archive-diff.mjs")) && /!universe\.has\(c10\)/.test(readCodeOnly("scripts/sec-archive-diff.mjs")));
  const SRC = fs.readFileSync("lib/secArchiveUniverse.mjs", "utf8");
  const ANCHOR = "  for (const c of Object.values(extra ?? {})) if (c) out.add(cik10(c));\n";
  if (SRC.split(ANCHOR).length !== 2) throw new Error("universe mutation anchor must match once");
  const tmp = `lib/.check-sec-archive-u-${process.pid}.mjs`;
  fs.writeFileSync(tmp, SRC.replace(ANCHOR, ""));
  let MU;
  try { MU = await import(`../${tmp}`); } finally { fs.rmSync(tmp, { force: true }); }
  check("MUTATION: stored-set CIKs left out of the universe → SPY's CIK is missing (caught)", !MU.archiveUniverse(fx).includes("0000884394"));
}

console.log("\n4. the workflow and isolation");
const WF = fs.readFileSync(".github/workflows/sec-archive.yml", "utf8");
const yamlCode = (t) => t.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
const jobOf = (name) => (yamlCode(WF).split(/\n  (?=[a-z]+:\n)/).find((b) => b.startsWith(`${name}:`)) ?? "");
const code = readCodeOnly("scripts/sec-archive-backfill.mjs") + readCodeOnly("scripts/sec-archive-incremental.mjs") + readCodeOnly("lib/secArchive.mjs") + readCodeOnly("lib/secArchiveBackfill.mjs") + readCodeOnly("lib/secArchiveIncremental.mjs");
check("one runner: no shard input or SHARD variable", !/SHARD/.test(code + WF));
check("R2 credentials come only from the workflow's secrets", /R2_SECRET_ACCESS_KEY: \$\{\{ secrets\.R2_SECRET_ACCESS_KEY \}\}/.test(WF) && !/R2_SECRET_ACCESS_KEY\s*=\s*["']/.test(code));
check("three jobs; Upstash appears ONLY in the diff job, never in backfill or incremental",
  Boolean(jobOf("backfill") && jobOf("incremental") && jobOf("diff")) && /UPSTASH_REDIS_REST_TOKEN/.test(jobOf("diff")) && !/UPSTASH/i.test(jobOf("backfill") + jobOf("incremental")));
check("the relay references no R2 secret", !/R2_/.test(yamlCode(fs.readFileSync(".github/workflows/relay.yml", "utf8"))));
check("schedule: daily 03:05 UTC, and only the incremental job runs on it; one at a time; read-only repo token",
  /cron: "5 3 \* \* \*"/.test(WF) && /github\.event_name == 'schedule' \|\| inputs\.task == 'incremental'/.test(jobOf("incremental")) &&
  /github\.event_name == 'workflow_dispatch'/.test(jobOf("backfill")) && /github\.event_name == 'workflow_dispatch'/.test(jobOf("diff")) &&
  /group: sec-archive/.test(WF) && /contents: read/.test(WF));
check("the incremental budget (30 min) ends before 03:40", /budgetMs = 30 \* 60 \* 1000/.test(readCodeOnly("lib/secArchiveIncremental.mjs")));
check("a throttled run exits red, as does >2% failed (backfill and incremental)",
  /status === "throttled" \|\| T\.failed > Math\.max\(5, T\.archived \* 0\.02\)/.test(readCodeOnly("scripts/sec-archive-backfill.mjs")) &&
  /status === "throttled" \|\| status === "no-archive" \|\| T\.failed > Math\.max\(5, T\.filers \* 0\.02\)/.test(readCodeOnly("scripts/sec-archive-incremental.mjs")));
check("backfill and incremental touch no Redis and no Layer 2 (code, not comments)", !/redis|upstash|secFactStore|writeFactSet/i.test(code));

console.log(`\n${failures ? `${failures} FAILED` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
