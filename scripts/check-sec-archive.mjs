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

console.log("\n4. the workflow and isolation");
const WF = fs.readFileSync(".github/workflows/sec-archive.yml", "utf8");
const code = readCodeOnly("scripts/sec-archive-backfill.mjs") + readCodeOnly("lib/secArchive.mjs") + readCodeOnly("lib/secArchiveBackfill.mjs");
check("one runner: no shard input or SHARD variable", !/SHARD/.test(code + WF));
check("R2 credentials come only from the workflow's secrets", /R2_SECRET_ACCESS_KEY: \$\{\{ secrets\.R2_SECRET_ACCESS_KEY \}\}/.test(WF) && !/R2_SECRET_ACCESS_KEY\s*=\s*["']/.test(code));
const yamlCode = (t) => t.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
check("the archive workflow references no Upstash secret, and the relay references no R2 secret",
  !/UPSTASH/i.test(yamlCode(WF)) && !/R2_/.test(yamlCode(fs.readFileSync(".github/workflows/relay.yml", "utf8"))));
check("dispatch-only, one at a time (concurrency group), read-only repo token", /workflow_dispatch:/.test(WF) && !/schedule:/.test(WF) && /group: sec-archive/.test(WF) && /contents: read/.test(WF));
check("a throttled run exits red, as does >2% failed", /status === "throttled" \|\| T\.failed > Math\.max\(5, T\.archived \* 0\.02\)/.test(readCodeOnly("scripts/sec-archive-backfill.mjs")));
check("nothing here touches Redis or Layer 2 (code, not comments)", !/redis|upstash|secFactStore|writeFactSet/i.test(code));

console.log(`\n${failures ? `${failures} FAILED` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
