// THE COMPANY'S OWN DESCRIPTION, FOR EVERY PROFILED SYMBOL (PR 3 render, #518).
//
// The owner approved the 31-symbol sample (data/sec/description-probe.json,
// relay 35785947942). This runs the SAME locator and cleaner — lifted from
// lib/server/secDescription.ts — over every symbol in data/sec/registrants.json,
// and writes one shard of data/sec/descriptions.json. The page reads the merged
// file; nothing here is fetched at request time, because an annual filing is
// megabytes of HTML and the description changes once a year.
//
// SHARDED because the read-only relay job stops at 30 minutes: SHARD="k/N"
// takes every N-th symbol (sorted), offset k-1. Each shard writes
// data/sec/descriptions-part-k.json; .github/workflows/descriptions-commit.yml
// merges the shards on a runner (the artifact host is refused to the sandbox).
//
// SKIPPED WITHOUT A FETCH: a registrant whose latest annual form is 40-F
// (owner, #518: no description for now) or null (no annual report filed).
//
// Read-only, no credentials. ≤8 requests/s, under SEC's 10/s.
//
//   SHARD=1/6 node scripts/sec-descriptions-build.mjs   (relay task: sec-descriptions-1 … -6)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { readCodeOnly } from "./lib/source-code.mjs";
import { lift } from "./lib/earnings-plan.mjs";

const UA = process.env.SEC_USER_AGENT ||
  "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; description build)";
const [K, N] = (process.env.SHARD || "1/1").split("/").map(Number);
if (!(K >= 1 && N >= K)) throw new Error(`bad SHARD ${process.env.SHARD}`);
// A budget under the job's 30 minutes, so a slow shard still writes its file.
const BUDGET_MS = Number(process.env.BUDGET_MS || 26 * 60 * 1000);
const started = Date.now();

const desc = await lift(readCodeOnly("lib/server/secDescription.ts"));

// THE DICTIONARY FOR SPLIT WORDS ("op erates"; owner, #518 round 5). A pinned
// word list, installed in an EMPTY temp dir (the relay-run.mjs typescript
// pattern: nothing from package.json comes with it, and --ignore-scripts runs
// none of its code). Build-time only: the page never loads a word list.
const WORDS_PKG = "an-array-of-english-words@2.0.0";
function loadWords() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "desc-words-"));
  // A package.json of its own, or npm installs into the nearest ANCESTOR that
  // has one or a node_modules (seen in the sandbox: "removed 2 packages").
  fs.writeFileSync(path.join(tmp, "package.json"), '{"private":true}\n');
  const r = spawnSync("npm", ["install", "--no-save", "--no-package-lock", "--no-audit", "--no-fund", "--ignore-scripts", WORDS_PKG], { cwd: tmp, stdio: "inherit" });
  const file = path.join(tmp, "node_modules", "an-array-of-english-words", "index.json");
  if (r.status !== 0 || !fs.existsSync(file)) throw new Error(`could not install ${WORDS_PKG} (exit ${r.status})`);
  const words = new Set(JSON.parse(fs.readFileSync(file, "utf8")));
  if (words.size < 200_000) throw new Error(`${WORDS_PKG}: ${words.size} words, expected ~275k`);
  console.log(`dictionary: ${WORDS_PKG}, ${words.size} words`);
  return words;
}
const WORDS = loadWords();
const isWord = (w) => WORDS.has(w);
let joinedWords = 0;
let joinedRows = 0;
const REG = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8"));
const only = (process.env.SYMBOLS || "").split(/[,\s]+/).filter(Boolean);
const all = Object.keys(REG.rows).sort();
const mine = (only.length ? only : all).filter((_, i) => only.length || i % N === K - 1);

let lastAt = 0;
async function get(url, as = "json") {
  const wait = Math.max(0, lastAt + 130 - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastAt = Date.now();
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return { status: res.status };
    return { status: 200, body: as === "json" ? await res.json() : await res.text() };
  } catch (e) {
    return { status: `error ${e?.name ?? e}` };
  }
}

/** The newest annual filing, reading older submission pages if needed. Same as the probe. */
async function latestAnnual(sub) {
  const ANNUAL = ["10-K", "10-K405", "10-KT", "20-F", "40-F"];
  const pick = (r) => {
    const i = (r.form ?? []).findIndex((f) => ANNUAL.includes(f));
    return i < 0 ? null : { form: r.form[i], accession: r.accessionNumber[i], filedOn: r.filingDate[i], doc: r.primaryDocument[i] };
  };
  const found = pick(sub.filings?.recent ?? {});
  if (found) return found;
  for (const f of sub.filings?.files ?? []) {
    const page = await get(`https://data.sec.gov/submissions/${f.name}`);
    if (page.status === 200) { const hit = pick(page.body); if (hit) return hit; }
  }
  return null;
}

const rows = {};
const misses = {};
let reached = 0;
for (const symbol of mine) {
  if (Date.now() - started > BUDGET_MS) break;
  reached++;
  const t0 = Date.now();
  const slow = (phase) => { const ms = Date.now() - t0; if (ms > 10_000) console.log(`  slow: ${symbol} ${Math.round(ms / 1000)}s at ${phase}`); };
  const reg = REG.rows[symbol];
  if (!reg?.cik) { misses[symbol] = "no CIK"; continue; }
  if (reg.annualForm === "40-F") { misses[symbol] = "40-F: skipped (owner, #518)"; continue; }
  if (!reg.annualForm) { misses[symbol] = "no annual report filed"; continue; }
  const sub = await get(`https://data.sec.gov/submissions/CIK${reg.cik}.json`);
  if (sub.status !== 200) { misses[symbol] = `submissions ${sub.status}`; continue; }
  const annual = await latestAnnual(sub.body);
  if (!annual) { misses[symbol] = "no annual report filed"; continue; }
  if (annual.form === "40-F") { misses[symbol] = "40-F: skipped (owner, #518)"; continue; }
  const url = `https://www.sec.gov/Archives/edgar/data/${Number(reg.cik)}/${annual.accession.replace(/-/g, "")}/${annual.doc}`;
  const page = await get(url, "text");
  if (page.status !== 200) { misses[symbol] = `document ${page.status}`; continue; }
  slow(`fetch (${Math.round(page.body.length / 1e6)} MB)`);
  const loc = desc.locateSection(desc.filingText(page.body), annual.form);
  if (!loc.found) { misses[symbol] = loc.why; continue; }
  const cleaned = desc.cleanDescription(loc.body, { companyName: sub.body.name ?? null, isWord });
  slow("clean");
  if (!cleaned.ok) { misses[symbol] = cleaned.why; continue; }
  if (cleaned.joined) { joinedWords += cleaned.joined; joinedRows++; }
  rows[symbol] = [annual.form, annual.filedOn, annual.accession, cleaned.text];
}
const notReached = mine.slice(reached);

fs.mkdirSync("data/sec", { recursive: true });
const out = `data/sec/descriptions-part-${only.length ? "adhoc" : K}.json`;
fs.writeFileSync(out, JSON.stringify({
  shard: `${K}/${N}`, asOf: new Date().toISOString().slice(0, 10), symbols: mine.length,
  rows, misses, notReached, joined: { words: joinedWords, rows: joinedRows },
}) + "\n");

// THE LOG IS A SUMMARY: the rows themselves go in the file, reviewed from the repo.
const why = {};
for (const w of Object.values(misses)) { const k = w.replace(/\d+x/, "Nx"); why[k] = (why[k] ?? 0) + 1; }
console.log(`shard ${K}/${N}: ${mine.length} symbols · described ${Object.keys(rows).length} · no description ${Object.keys(misses).length} · not reached ${notReached.length} · split words joined ${joinedWords} in ${joinedRows} rows · ${Math.round((Date.now() - started) / 1000)}s`);
for (const [w, n] of Object.entries(why).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${w}`);
console.log(`wrote ${out}`);
