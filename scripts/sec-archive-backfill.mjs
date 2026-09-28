// THE SEC ARCHIVE BACKFILL (#552 COWORK #65 PR 1; storage: Cloudflare R2).
//
// Thin wrapper over lib/secArchiveBackfill.mjs: for every registrant CIK not
// yet archived, companyfacts → every fact as a row → facts/{cik}.ndjson.br;
// submissions with its older pages → submissions/{cik}.json.gz; the entry in
// index.json. ONE runner at ≤8 requests/s with our User-Agent (SEC's limit is
// per requester, not per machine), resumable from the checkpointed index.
// SEC 429/403 STOPS the run with the index saved (#552 COWORK #67).
//
// PUBLIC LOGS: status and counts only — never a value, never a key or URL.
// No Redis. Layer 2 is untouched (that is PR 2).
//
//   R2_ACCOUNT_ID=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… R2_BUCKET=… \
//   LIMIT=0 REFRESH=no node scripts/sec-archive-backfill.mjs
//   (workflow: .github/workflows/sec-archive.yml)
import fs from "node:fs";
import { r2Client } from "../lib/secArchive.mjs";
import { runBackfill } from "../lib/secArchiveBackfill.mjs";

const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows;
const universe = [...new Set(Object.values(REG).map((r) => String(r.cik).padStart(10, "0")))].sort();

const { status, T } = await runBackfill({
  universe,
  r2: r2Client(),
  fetchImpl: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(120_000) }),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => Date.now(),
  log: (line) => console.log(line),
  userAgent: process.env.SEC_USER_AGENT || "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; archive backfill)",
  limit: Number(process.env.LIMIT || 0),
  refresh: process.env.REFRESH === "yes",
  checkpoint: Number(process.env.CHECKPOINT || 50),
  budgetMs: Number(process.env.BUDGET_MS || 50 * 60 * 1000),
});
// RED RUN when SEC throttled us, or when more than 2% of CIKs failed: the owner sees it.
process.exit(status === "throttled" || T.failed > Math.max(5, T.archived * 0.02) ? 1 : 0);
