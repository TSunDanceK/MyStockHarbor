// HOW MANY SYMBOLS GET A DIFFERENT FISCAL YEAR NAME, AND WHICH.
//
// ── THE CANDIDATE SET IS DECIDED WITHOUT A SINGLE SEC CALL ───────────────
// A relabel is only possible when a filer's fiscal year END and its MIDPOINT
// fall in different calendar years — that is, a year-end in January to June.
// For a December, September or August year-end the two readings coincide and
// no calibration can move the label, so fetching companyfacts for those
// symbols would be ~3 MB apiece to prove nothing.
//
// So: the stored fact sets name the candidates (Redis only), and companyfacts
// is fetched ONLY for those. Reports SYMBOLS, never filings.
import fs from "node:fs";
import { Redis } from "@upstash/redis";
import { readCodeOnly } from "./lib/source-code.mjs";
import { grabFunction, lift } from "./lib/earnings-plan.mjs";

const redis = Redis.fromEnv();
const UA = process.env.SEC_USER_AGENT ??
  "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; fiscal year naming census)";

const fieldsSrc = readCodeOnly("lib/server/secFields.ts");
const extractSrc = readCodeOnly("lib/server/secExtract.ts")
  .replace(/import\s*\{[\s\S]*?\}\s*from\s*"\.\/secFields";/, "");
const sec = await lift(
  `${fieldsSrc}\n${extractSrc}\nexport { fiscalLabel, fiscalYearOffset, fiscalMidYear };`
);
const tickSrc = readCodeOnly("lib/server/secTickerMap.ts");
const tick = await lift(
  [grabFunction(tickSrc, "padCik"), grabFunction(tickSrc, "parseTickerFile")].join("\n") +
    "\nexport { parseTickerFile, padCik };"
);

const manifestSrc = fs.readFileSync("lib/server/secManifest.ts", "utf8");
const pick = (n) => (manifestSrc.match(new RegExp(`${n} = "([^"]+)"`)) ?? [])[1];
const SEC_MANIFEST_KEY = pick("SEC_MANIFEST_KEY");
const SEC_FACTS_PREFIX = pick("SEC_FACTS_PREFIX");
if (!SEC_MANIFEST_KEY || !SEC_FACTS_PREFIX) { console.error("FATAL: key names"); process.exit(2); }

const manifest = await redis.get(SEC_MANIFEST_KEY);
if (!manifest?.symbols) { console.error("FATAL: no manifest"); process.exit(2); }
const { map: tickerMap } = tick.parseTickerFile(
  fs.readFileSync("data/sec/company-tickers.json", "utf8")
);

const all = Object.entries(manifest.symbols).filter(([, e]) => e.cik).map(([s]) => s).sort();
console.log(`${all.length} SYMBOLS with a CIK in the manifest\n`);

// ── PASS 1: the candidates, from the store alone ─────────────────────────
const candidates = [];
let noSet = 0, noAnchor = 0, cannotMove = 0;
for (let i = 0; i < all.length; i += 50) {
  const batch = all.slice(i, i + 50);
  const sets = await Promise.all(batch.map((s) => redis.get(`${SEC_FACTS_PREFIX}:${s}`)));
  batch.forEach((symbol, k) => {
    const set = sets[k];
    if (!set?.quarters) { noSet++; return; }
    const yearEnds = (set.years ?? []).map((p) => p.e).filter(Boolean).sort();
    const anchor = yearEnds[yearEnds.length - 1] ?? null;
    if (!anchor) { noAnchor++; return; }
    const endYear = new Date(`${anchor}T00:00:00Z`).getUTCFullYear();
    const midYear = sec.fiscalMidYear(Date.parse(`${anchor}T00:00:00Z`));
    // THE ONLY FILERS A CALIBRATION CAN MOVE.
    if (endYear === midYear) { cannotMove++; return; }
    candidates.push({ symbol, anchor, set });
  });
}
console.log(`  ${noSet} SYMBOLS have no stored fact set`);
console.log(`  ${noAnchor} SYMBOLS have no annual frame to anchor on`);
console.log(`  ${cannotMove} SYMBOLS cannot move: year-end and midpoint share a calendar year`);
console.log(`  ${candidates.length} SYMBOLS are candidates (year-end January to June)\n`);

// ── PASS 2: the calibration, companyfacts only for the candidates ────────
let lastAt = 0;
const MIN_GAP_MS = 125;
const fetchJson = async (url) => {
  const wait = Math.max(0, lastAt + MIN_GAP_MS - Date.now());
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastAt = Date.now();
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" } });
  if (!res.ok) return null;
  return res.json();
};

const changed = [];
const kept = [];
const unread = [];
for (const { symbol, anchor, set } of candidates) {
  const cik = manifest.symbols[symbol]?.cik ?? tickerMap.get(symbol)?.cik;
  if (!cik) continue;
  const facts = await fetchJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`);
  if (!facts) { unread.push(`${symbol} (fetch failed)`); continue; }
  const naming = sec.fiscalYearOffset(facts, anchor);
  const newest = (set.quarters ?? [])[0]?.e ?? anchor;
  const was = sec.fiscalLabel(newest, anchor, null);
  const now = sec.fiscalLabel(newest, anchor, naming);
  const line = `${symbol.padEnd(6)} year-end ${anchor}  ${was.fp} FY${was.fy} -> ${now.fp} FY${now.fy}` +
    `  (offset ${naming.offset}, from ${naming.basis ?? "nothing"}, ${naming.agreeing} agreeing/${naming.disagreeing} not)`;
  if (naming.basis === null) unread.push(`${symbol.padEnd(6)} naming unreadable — label unchanged`);
  else if (was.fy !== now.fy) changed.push(line);
  else kept.push(line);
}

console.log("=".repeat(78));
console.log(`RELABELLED: ${changed.length} SYMBOLS`);
for (const l of changed) console.log(`  ${l}`);
console.log(`\nCANDIDATES CONFIRMED UNCHANGED: ${kept.length} SYMBOLS`);
for (const l of kept) console.log(`  ${l}`);
console.log(`\nNAMING UNREADABLE (label falls back, unchanged): ${unread.length} SYMBOLS`);
for (const l of unread) console.log(`  ${l}`);
console.log(`\nTOTAL SYMBOLS WHOSE LABEL CHANGES: ${changed.length} of ${all.length}`);
