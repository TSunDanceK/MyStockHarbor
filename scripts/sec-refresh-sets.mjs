// RE-EXTRACT AND REWRITE A NAMED SET OF FACT SETS, with the shipped code.
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────
// A labelling change (SEC_LABEL_VERSION) does not rewrite stored sets — the
// rewindow queue does, twenty-five a run, over weeks. That is right for a
// migration with no deadline and useless for an eye-check, which needs the new
// labels on a handful of named symbols now.
//
// IT RUNS THE SHIPPED FUNCTIONS. extractCompanyFacts and encodeFactSet are
// lifted from the modules the cron imports, so the bytes written here are the
// bytes the cron would write. A rewriter with its own extraction would prove
// only that the rewriter works.
//
// NOT A BACKFILL. It takes an explicit symbol list and refuses an empty one:
// pointed at the universe it would spend the whole SEC budget in one run and
// duplicate the queue that already does this properly.
import fs from "node:fs";
import { Redis } from "@upstash/redis";
import { readCodeOnly } from "./lib/source-code.mjs";
import { grabFunction, lift } from "./lib/earnings-plan.mjs";

const redis = Redis.fromEnv();
const UA = process.env.SEC_USER_AGENT ??
  "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; label refresh)";

const strip = (f) => readCodeOnly(f).replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "");
const sec = await lift(
  [
    readCodeOnly("lib/server/secFields.ts"),
    strip("lib/server/secExtract.ts"),
    strip("lib/server/secFactCodec.ts"),
    "export { extractCompanyFacts, encodeFactSet, SEC_LABEL_VERSION };",
  ].join("\n")
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

const SYMBOLS = (process.env.SYMBOLS || process.argv[2] || "")
  .split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
if (!SYMBOLS.length) {
  console.error("FATAL: SYMBOLS is required — this is not a backfill, the rewindow queue is");
  process.exit(2);
}

const manifest = await redis.get(SEC_MANIFEST_KEY);
if (!manifest?.symbols) { console.error("FATAL: no manifest"); process.exit(2); }
const { map: tickerMap } = tick.parseTickerFile(
  fs.readFileSync("data/sec/company-tickers.json", "utf8")
);

let lastAt = 0;
const fetchJson = async (url) => {
  const wait = Math.max(0, lastAt + 125 - Date.now());
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastAt = Date.now();
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" } });
  if (!res.ok) return null;
  return res.json();
};

console.log(`${SYMBOLS.length} SYMBOLS · SEC_LABEL_VERSION ${sec.SEC_LABEL_VERSION}\n`);
for (const symbol of SYMBOLS) {
  const cik = manifest.symbols[symbol]?.cik ?? tickerMap.get(symbol)?.cik;
  if (!cik) { console.log(`  ${symbol.padEnd(6)} no CIK`); continue; }
  const before = await redis.get(`${SEC_FACTS_PREFIX}:${symbol}`);
  const facts = await fetchJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`);
  if (!facts) { console.log(`  ${symbol.padEnd(6)} companyfacts fetch failed`); continue; }
  const set = sec.encodeFactSet(sec.extractCompanyFacts(symbol, facts));
  await redis.set(`${SEC_FACTS_PREFIX}:${symbol}`, set);
  // THE MANIFEST STAMP TOO, or the rewindow queue re-reads what was just
  // written — the same symbol, every day, for a migration already done.
  const entry = manifest.symbols[symbol];
  if (entry) { entry.lv = set.lv ?? 1; entry.c = set.c ?? null; }
  const lab = (p) => (p ? `${p.fp} FY${p.fy} (${p.e})` : "—");
  console.log(
    `  ${symbol.padEnd(6)} lv ${before?.lv ?? 1} -> ${set.lv}  newest quarter ` +
      `${lab(before?.quarters?.[0])} -> ${lab(set.quarters?.[0])}`
  );
}
await redis.set(SEC_MANIFEST_KEY, manifest);
console.log("\nmanifest stamped");
