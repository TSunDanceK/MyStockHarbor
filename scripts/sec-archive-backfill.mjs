// THE SEC ARCHIVE BACKFILL (#552 COWORK #65 PR 1; storage: Cloudflare R2).
//
// For every registrant CIK not yet archived: companyfacts → every fact as a
// row (lib/secArchive.mjs) → facts/{cik}.ndjson.br; submissions with its
// older pages → submissions/{cik}.json.gz; the entry in index.json. ONE runner
// at ≤8 requests/s with our User-Agent (SEC's limit is per requester, not per
// machine), resumable: the index is checkpointed every CHECKPOINT filers, and
// a CIK already in it is skipped unless REFRESH=yes.
//
// PUBLIC LOGS: status and counts only — never a value, never a key or URL.
// No Redis. Layer 2 is untouched (that is PR 2).
//
//   R2_ACCOUNT_ID=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… R2_BUCKET=… \
//   LIMIT=0 REFRESH=no node scripts/sec-archive-backfill.mjs
//   (workflow: .github/workflows/sec-archive.yml)
import fs from "node:fs";
import zlib from "node:zlib";
import { factsToRows, encodeFacts, newestFiling, sha256, r2Client, ARCHIVE_VERSION } from "../lib/secArchive.mjs";

const UA = process.env.SEC_USER_AGENT || "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; archive backfill)";
const LIMIT = Number(process.env.LIMIT || 0);
const REFRESH = process.env.REFRESH === "yes";
const CHECKPOINT = Number(process.env.CHECKPOINT || 50);
const BUDGET_MS = Number(process.env.BUDGET_MS || 50 * 60 * 1000);
const MIN_GAP_MS = 125; // ≤8 requests/s, one runner
const started = Date.now();

const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows;
const universe = [...new Set(Object.values(REG).map((r) => String(r.cik).padStart(10, "0")))].sort();
const r2 = r2Client();

let lastAt = 0;
async function sec(url) {
  const wait = Math.max(0, lastAt + MIN_GAP_MS - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastAt = Date.now();
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" }, signal: AbortSignal.timeout(120_000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`SEC ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

const prior = await r2.get("index.json");
const index = prior ? JSON.parse(prior.toString("utf8")) : { v: ARCHIVE_VERSION, entries: {} };
const todo = universe.filter((c) => REFRESH || !index.entries[c]);
const batch = LIMIT > 0 ? todo.slice(0, LIMIT) : todo;
console.log(`universe ${universe.length} · archived ${Object.keys(index.entries).length} · to do ${todo.length} · this run ${batch.length}`);

const T = { archived: 0, noFacts: 0, failed: 0, secRequests: 0, puts: 0, factRows: 0, factBytes: 0, subBytes: 0 };
const saveIndex = async () => {
  index.updatedAt = new Date().toISOString();
  await r2.put("index.json", Buffer.from(JSON.stringify(index)), "application/json");
  T.puts++;
};
let sinceCheckpoint = 0;
for (const cik of batch) {
  if (Date.now() - started > BUDGET_MS) { console.log("budget reached; the next run resumes from the index"); break; }
  try {
    const cf = await sec(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`); T.secRequests++;
    const sub = await sec(`https://data.sec.gov/submissions/CIK${cik}.json`); T.secRequests++;
    const subJson = sub ? JSON.parse(sub.toString("utf8")) : null;
    const pages = [];
    for (const p of subJson?.filings?.files ?? []) {
      const page = await sec(`https://data.sec.gov/submissions/${p.name}`); T.secRequests++;
      if (page) pages.push(JSON.parse(page.toString("utf8")));
    }
    const entry = { at: new Date().toISOString(), rows: 0, newest: null, factsSha: null, subSha: null, pages: pages.length };
    if (cf) {
      const archived = factsToRows(JSON.parse(cf.toString("utf8")));
      const body = encodeFacts(archived);
      await r2.put(`facts/${cik}.ndjson.br`, body, "application/x-ndjson"); T.puts++;
      Object.assign(entry, { rows: archived.rows.length, newest: newestFiling(archived.rows), factsSha: sha256(body) });
      T.factRows += archived.rows.length; T.factBytes += body.length;
    } else T.noFacts++;
    if (subJson) {
      const body = zlib.gzipSync(Buffer.from(JSON.stringify({ main: subJson, pages })), { level: 9 });
      await r2.put(`submissions/${cik}.json.gz`, body, "application/json");
      T.puts++; T.subBytes += body.length; entry.subSha = sha256(body);
    }
    index.entries[cik] = entry;
    T.archived++;
    if (++sinceCheckpoint >= CHECKPOINT) { await saveIndex(); sinceCheckpoint = 0; }
  } catch (e) {
    T.failed++;
    // Status only: the error class and HTTP status, no URL (it names the CIK path).
    console.log(`failed: ${String(e?.message ?? e).replace(/https?:\/\/\S+/g, "<url>").slice(0, 60)}`);
  }
}
await saveIndex();
const mb = (b) => (b / 1e6).toFixed(1);
console.log(`archived ${T.archived} · no companyfacts ${T.noFacts} · failed ${T.failed} · SEC requests ${T.secRequests} · R2 puts ${T.puts} · fact rows ${T.factRows} · facts ${mb(T.factBytes)} MB · submissions ${mb(T.subBytes)} MB · index now ${Object.keys(index.entries).length}/${universe.length} · ${Math.round((Date.now() - started) / 1000)}s`);
process.exit(T.failed > Math.max(5, T.archived * 0.02) ? 1 : 0);
