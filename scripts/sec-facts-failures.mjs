// WHICH FACT SETS FAILED, AND WHY — reproduced, not guessed.
//
// sec-facts reports `failed: N` but, until this branch, did not name them: the
// per-symbol errors went into the HTTP response body, which the cron discards.
// A failed symbol is NOT cleared from its queue (that is what makes tomorrow
// retry it), so the failures are still sitting in the reverify / populate
// queues, or at the head of rewindow. This re-runs the shipped fetch rule and
// the shipped extraction over exactly those candidates and prints every one
// that throws, with the error the cron would have recorded.
//
// Credentialled (Upstash) and READ-ONLY: one manifest GET, SEC fetches, no SET.
//
//   REWINDOW_HEAD=40 node scripts/sec-facts-failures.mjs
import fs from "node:fs";
import { Redis } from "@upstash/redis";
import { readCodeOnly } from "./lib/source-code.mjs";
import { lift } from "./lib/earnings-plan.mjs";

const redis = Redis.fromEnv();
const UA = process.env.SEC_USER_AGENT ??
  "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; failure diagnosis)";
const REWINDOW_HEAD = Number(process.env.REWINDOW_HEAD ?? 40);

const strip = (f) => readCodeOnly(f).replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "");
const sec = await lift(
  [
    readCodeOnly("lib/server/secFields.ts"),
    strip("lib/server/secExtract.ts"),
    strip("lib/server/fxRates.ts"),
    strip("lib/server/secCurrency.ts"),
    strip("lib/server/secFactCodec.ts"),
    strip("lib/server/secFactBuild.ts"),
    strip("lib/server/secStaleness.ts"),
    "export { extractCompanyFacts, toStoredSet, needsReread };",
  ].join("\n")
);

const ROUTE = readCodeOnly("lib/server/jobBudget.ts");
const TIMEOUT = Number((ROUTE.match(/FETCH_TIMEOUT_MS = ([\d_]+)/) ?? [])[1]?.replace(/_/g, ""));
if (!Number.isFinite(TIMEOUT)) { console.error("FATAL: could not read FETCH_TIMEOUT_MS"); process.exit(2); }

const manifestSrc = fs.readFileSync("lib/server/secManifest.ts", "utf8");
const SEC_MANIFEST_KEY = (manifestSrc.match(/SEC_MANIFEST_KEY = "([^"]+)"/) ?? [])[1];
const manifest = await redis.get(SEC_MANIFEST_KEY);
if (!manifest?.symbols) { console.error("FATAL: no manifest"); process.exit(2); }

const entries = Object.entries(manifest.symbols).filter(([, e]) => e.cik);
const reverify = entries.filter(([, e]) => e.needsReverify).map(([s]) => s);
const populate = entries.filter(([, e]) => !e.needsReverify && e.contentHash === null).map(([s]) => s).sort();
const rewindow = entries
  .filter(([, e]) => !e.needsReverify && e.contentHash !== null && sec.needsReread(e))
  .map(([s]) => s).sort();
console.log(`queues now: reverify ${reverify.length} · populate ${populate.length} · rewindow ${rewindow.length}`);
console.log(`trying: all of reverify and populate, and the first ${REWINDOW_HEAD} of rewindow\n`);

let lastAt = 0;
const fetchFacts = async (cik) => {
  const wait = Math.max(0, lastAt + 125 - Date.now());
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastAt = Date.now();
  const t0 = Date.now();
  const res = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, {
    headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("json")) throw new Error(`expected JSON, got ${ct}`);
  const json = await res.json();
  return { json, ms: Date.now() - t0 };
};

const fxCache = new Map();
const failures = [];
const tried = [
  ...reverify.map((s) => ["reverify", s]),
  ...populate.map((s) => ["populate", s]),
  ...rewindow.slice(0, REWINDOW_HEAD).map((s) => ["rewindow", s]),
];
for (const [queue, symbol] of tried) {
  const e = manifest.symbols[symbol];
  try {
    const { json, ms } = await fetchFacts(e.cik);
    await sec.toStoredSet(sec.extractCompanyFacts(symbol, json), undefined, fxCache);
    if (ms > TIMEOUT * 0.6) console.log(`  slow   ${queue.padEnd(8)} ${symbol.padEnd(8)} ${ms}ms of a ${TIMEOUT}ms timeout`);
  } catch (err) {
    const msg = String(err?.message ?? err);
    failures.push({ queue, symbol, cik: e.cik, entityName: e.entityName ?? null, msg });
    console.log(`  FAILS  ${queue.padEnd(8)} ${symbol.padEnd(8)} CIK ${e.cik}  ${msg}`);
  }
}
console.log(`\n${failures.length} of ${tried.length} candidates fail today with the shipped fetch rule and extraction`);
console.log("No writes were performed.");
