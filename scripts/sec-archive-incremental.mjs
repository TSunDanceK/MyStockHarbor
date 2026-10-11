// THE DAILY INCREMENTAL ARCHIVE (#552 COWORK #70): thin wrapper over
// lib/secArchiveIncremental.mjs. Reads EDGAR's daily form index for every
// business day since the archive's `lastDaily`, and re-archives the registrant
// CIKs that filed (facts and submissions after a financial form, submissions
// only otherwise). One runner, ≤4 SEC requests/s, stops on 429/403 with the
// index saved, and skips (or stops) inside an SEC job window (the clock guard). Public logs: counts only. No Redis; Layer 2 untouched.
//
//   R2_… env as for the backfill · node scripts/sec-archive-incremental.mjs
//   (workflow: .github/workflows/sec-archive.yml, task "incremental", daily)
import fs from "node:fs";
import { r2Client } from "../lib/secArchive.mjs";
import { readArchiveUniverse } from "../lib/secArchiveUniverse.mjs";
import { runIncremental } from "../lib/secArchiveIncremental.mjs";

// THE UNIVERSE: registrants ∪ stored-set CIKs ∪ predecessor CIKs (COWORK #71).
const universe = readArchiveUniverse(fs);

const { status, T } = await runIncremental({
  universe,
  r2: r2Client(),
  fetchImpl: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(120_000) }),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => Date.now(),
  log: (line) => console.log(line),
  userAgent: process.env.SEC_USER_AGENT || "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; archive incremental)",
  todayIso: new Date().toISOString().slice(0, 10),
});
// RED RUN when SEC throttled us, when there is no archive, or when more than 2% failed.
// A window skip is GREEN: it is the guard working, and the next run resumes.
process.exit(status === "throttled" || status === "no-archive" || T.failed > Math.max(5, T.filers * 0.02) ? 1 : 0);
