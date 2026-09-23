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
import { loadCards } from "./lib/render-cards.mjs";

const redis = Redis.fromEnv();
const UA = process.env.SEC_USER_AGENT ??
  "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; label refresh)";

const strip = (f) => readCodeOnly(f).replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "");
// ── THROUGH toStoredSet, THE PATH THE CRON AND THE COLD FETCH BOTH TAKE ──
// This used to call encodeFactSet(extractCompanyFacts(...)) directly, which
// skips currency conversion. Harmless on the USD filers it was written for;
// on a EUR/GBP/CAD filer it writes the filer's own figures with `cur` set and
// no `fx`, and buildSecEarningsView REFUSES exactly that shape — so a refresh
// meant to add a marker to ABVX would have blanked ABVX's page. The shipped
// orchestration converts, or stores the set empty-and-labelled when no rates
// exist, which is what the cron would have written.
const sec = await lift(
  [
    readCodeOnly("lib/server/secFields.ts"),
    strip("lib/server/secExtract.ts"),
    strip("lib/server/fxRates.ts"),
    strip("lib/server/secCurrency.ts"),
    strip("lib/server/secFactCodec.ts"),
    strip("lib/server/secFactBuild.ts"),
    "export { extractCompanyFacts, toStoredSet, SEC_LABEL_VERSION };",
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

const fxCache = new Map();

// WHAT A READER WOULD SEE CHANGE: annual revenue and the score band, before and
// after, through the shipped view and scorer (the same unit the earnings-page
// render harness uses). Printed only; a failure here never blocks the write.
const cards = await loadCards().catch((e) => { console.log(`(report unavailable: ${e.message})`); return null; });
const readerView = (symbol, set) => {
  if (!cards || !set) return null;
  try {
    const view = cards.buildSecEarningsView(set);
    const score = cards.scoreFromSec(view, symbol, { status: "ready" });
    const rev = (view?.annual ?? []).map((a) => `${a.label} ${a.revenue?.val == null ? "—" : `$${(a.revenue.val / 1e6).toFixed(1)}M`}`);
    return { rev, band: score.available ? `${score.score} ${cards.toneLabel(score.tone)}` : "not scored" };
  } catch (e) {
    return { rev: [], band: `view threw: ${e.message}` };
  }
};
console.log(`${SYMBOLS.length} SYMBOLS · SEC_LABEL_VERSION ${sec.SEC_LABEL_VERSION}\n`);
for (const symbol of SYMBOLS) {
  const cik = manifest.symbols[symbol]?.cik ?? tickerMap.get(symbol)?.cik;
  if (!cik) { console.log(`  ${symbol.padEnd(6)} no CIK`); continue; }
  const before = await redis.get(`${SEC_FACTS_PREFIX}:${symbol}`);
  const facts = await fetchJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`);
  if (!facts) { console.log(`  ${symbol.padEnd(6)} companyfacts fetch failed`); continue; }
  const set = await sec.toStoredSet(sec.extractCompanyFacts(symbol, facts), undefined, fxCache);
  // A NON-USD FILER WITH NO RATES WOULD NOW BE WRITTEN EMPTY. That is the
  // cron's behaviour too, but a refresh is run to IMPROVE a named set, so it
  // refuses to replace a populated one with an empty one.
  if (set.cur && set.cur !== "USD" && !set.fx && (before?.quarters?.length ?? 0) > 0) {
    console.log(`  ${symbol.padEnd(6)} ${set.cur} rates unavailable — NOT written (would blank a populated set)`);
    continue;
  }
  await redis.set(`${SEC_FACTS_PREFIX}:${symbol}`, set);
  // THE MANIFEST STAMP TOO, or the rewindow queue re-reads what was just
  // written — the same symbol, every day, for a migration already done.
  const entry = manifest.symbols[symbol];
  if (entry) { entry.lv = set.lv ?? 1; entry.c = set.c ?? null; }
  const lab = (p) => (p ? `${p.fp} FY${p.fy} (${p.e})` : "—");
  console.log(
    `  ${symbol.padEnd(6)} lv ${before?.lv ?? 1} -> ${set.lv}  newest quarter ` +
      `${lab(before?.quarters?.[0])} -> ${lab(set.quarters?.[0])}  cur=${set.cur ?? "USD"} ` +
      `fx=${set.fx ? `${set.fx.source} (${set.fx.applied.length} rates)` : "none"}  ` +
      `nt=${set.nt ? `[${set.nt.slice(0, 6).join(", ")}${set.nt.length > 6 ? ", ..." : ""}]` : "absent"}  ` +
      `rns=${JSON.stringify(set.rns ?? null)}`
  );
  const b = readerView(symbol, before);
  const a = readerView(symbol, set);
  if (a) {
    console.log(`         score ${b?.band ?? "—"} -> ${a.band}${b && b.band.split(" ")[1] !== a.band.split(" ")[1] ? "   <-- BAND CHANGED" : ""}`);
    console.log(`         annual revenue before: ${b?.rev.join(" · ") || "—"}`);
    console.log(`         annual revenue after:  ${a.rev.join(" · ") || "—"}`);
  }
}
await redis.set(SEC_MANIFEST_KEY, manifest);
console.log("\nmanifest stamped");
