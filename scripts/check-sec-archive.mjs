// THE SEC ARCHIVE, LAYER 1 (#552 COWORK #65 PR 1), run and mutated.
//   1. SigV4 reproduces AWS's published example signature exactly (the
//      "GET Object" example: examplebucket, test.txt, Range bytes=0-9).
//      MUTATION: signed headers left unsorted → a different signature.
//   2. Nothing is dropped: companyfacts → rows → companyfacts round-trips every
//      fact of every taxonomy, and the encoded object decodes to the same rows.
//      MUTATION: one taxonomy skipped in the normaliser → caught.
//   3. The backfill: one runner (no sharding), ≤8 requests/s, resumable from
//      the index, public log carries counts only, credentials only from the
//      workflow's secrets, and the workflow references no Upstash secret.
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

console.log("\n3. the backfill and its workflow");
const BF = fs.readFileSync("scripts/sec-archive-backfill.mjs", "utf8");
const WF = fs.readFileSync(".github/workflows/sec-archive.yml", "utf8");
check("≤8 SEC requests/s from one runner (125 ms gap, no SHARD)", /MIN_GAP_MS = 125\b/.test(BF) && !/SHARD/.test(BF));
check("resumable: skips CIKs already in the index unless REFRESH, and checkpoints the index", /REFRESH \|\| !index\.entries\[c\]/.test(BF) && /sinceCheckpoint >= CHECKPOINT/.test(BF));
const logs = [...BF.matchAll(/console\.log\(([^\n]*?)\);/g)].map((m) => m[1]);
check("public log lines print counts and status only (no val, no row, no URL)",
  logs.length >= 3 && logs.every((l) => !/\bval\b|rows\[|JSON\.stringify|cik\}|`https/.test(l)), `${logs.length} log lines`);
check("R2 credentials come only from the workflow's secrets", /R2_SECRET_ACCESS_KEY: \$\{\{ secrets\.R2_SECRET_ACCESS_KEY \}\}/.test(WF) && !/R2_SECRET_ACCESS_KEY\s*=\s*["']/.test(BF));
const yamlCode = (t) => t.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
check("the archive workflow references no Upstash secret, and the relay references no R2 secret",
  !/UPSTASH/i.test(yamlCode(WF)) && !/R2_/.test(yamlCode(fs.readFileSync(".github/workflows/relay.yml", "utf8"))));
check("dispatch-only, one at a time (concurrency group), read-only repo token", /workflow_dispatch:/.test(WF) && !/schedule:/.test(WF) && /group: sec-archive/.test(WF) && /contents: read/.test(WF));
check("nothing here touches Redis or Layer 2 (code, not comments)", !/redis|upstash|secFactStore|writeFactSet/i.test(readCodeOnly("scripts/sec-archive-backfill.mjs") + readCodeOnly("lib/secArchive.mjs")));

console.log(`\n${failures ? `${failures} FAILED` : "ALL CHECKS PASSED"}\n`);
process.exit(failures ? 1 : 0);
