// THREE FOLLOW-UPS TO THE PAIRING RULE, measured, nothing adopted.
// (Review of #515, 2026-09-22.)
//
//   T  THE SAME-DAY TIE-BREAK. When the pick was filed the SAME DAY as the
//      period's 10-Q/10-K and an earlier ORIGINAL 2.02 in the window sits
//      beyond the filer's early cut, keep the earlier one. Every period it
//      would flip is listed -- symbol, period, both dates, both accessions --
//      for a hand check before anything is adopted. The early cut is the
//      filer's own midpoint (looksLikeEarlyNonResults) where it has a pattern;
//      a filer with no pattern has no early cut, so any earlier original
//      qualifies. Both populations are printed separately.
//   G  A GENERAL CURRENT-PERIOD RULE (optional). A 2.02 whose lag is below the
//      midpoint of 0 and the filer's paired median results lag does not count.
//      Scored on history: how many TRUE paired results releases it would have
//      rejected, named.
//   F  WHY 48 OF 76 FPIs ARE TOO THIN TO SCORE: short history, semiannual
//      reporting, or the 6-K positional match missing periods it has.
//
// READS ONLY: Redis (records, fact sets, manifest) and data.sec.gov.
//   relay task: write-pairing-followups
import fs from "node:fs";
import { Redis } from "@upstash/redis";
import { readCodeOnly } from "./lib/source-code.mjs";
import { lift } from "./lib/earnings-plan.mjs";

const redis = Redis.fromEnv();
const UA = process.env.SEC_USER_AGENT ??
  "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; pairing follow-ups)";

const strip = (f) => readCodeOnly(f).replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "");
const SEC = await lift(strip("lib/server/secReportDates.ts").replace(/export (const|function|type)/g, "$1") +
  "\nexport { resultsPairing, earlyNonResultsPattern, looksLikeEarlyNonResults, daysBetween, median };", "", "secReportDates");

const keyOf = (src, n) => (fs.readFileSync(src, "utf8").match(new RegExp(`${n} = "([^"]+)"`)) ?? [])[1];
const SEC_MANIFEST_KEY = keyOf("lib/server/secManifest.ts", "SEC_MANIFEST_KEY");
const SEC_FACTS_PREFIX = keyOf("lib/server/secManifest.ts", "SEC_FACTS_PREFIX");
const DATES_PREFIX = keyOf("lib/server/secReportDatesStore.ts", "SEC_REPORT_DATES_PREFIX");
const MIN_USABLE = Number((fs.existsSync("lib/server/expectedToReport.ts")
  ? fs.readFileSync("lib/server/expectedToReport.ts", "utf8").match(/MIN_USABLE_PERIODS = (\d+)/)?.[1] : null) ?? 8);

let lastAt = 0;
const fetchJson = async (url) => {
  const wait = Math.max(0, lastAt + 125 - Date.now());
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastAt = Date.now();
  for (let a = 0; a < 3; a++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" } });
      if (res.ok) return await res.json();
      if (res.status !== 429 && res.status < 500) return null;
    } catch { /* retried */ }
    await new Promise((r) => setTimeout(r, 1000 * (a + 1)));
  }
  return null;
};

const manifest = await redis.get(SEC_MANIFEST_KEY);
if (!manifest?.symbols) { console.error("FATAL: no manifest"); process.exit(2); }
const universe = Object.entries(manifest.symbols).filter(([, e]) => e?.cik).map(([s]) => s).sort();

const flips = { pattern: [], noPattern: [] };
let sameDayPicks = 0, pairedPeriods = 0;
const general = { scored: 0, rejected: [] };
const fpi = [];

for (const symbol of universe) {
  const [rec, set] = await Promise.all([
    redis.get(`${DATES_PREFIX}:${symbol}`), redis.get(`${SEC_FACTS_PREFIX}:${symbol}`),
  ]);
  if (!set?.quarters) continue;
  const isFpi = (rec?.events ?? []).some((e) => e?.basis === "6-K near period end");
  const subs = await fetchJson(`https://data.sec.gov/submissions/CIK${manifest.symbols[symbol].cik}.json`);
  if (!subs?.filings?.recent) continue;
  const quarterEnds = set.quarters.map((p) => p.e).filter(Boolean);
  const yearEnds = (set.years ?? []).map((p) => p.e).filter(Boolean);
  const pairing = SEC.resultsPairing(subs, new Set([...quarterEnds, ...yearEnds]));
  const pattern = SEC.earlyNonResultsPattern(pairing.periods);
  const paired = pairing.periods.filter((p) => p.rule === "paired");
  pairedPeriods += paired.length;

  // ── T ──
  for (const p of paired) {
    if (p.picked.announcedOn !== p.periodicFiledOn) continue;
    sameDayPicks++;
    const earlier = p.candidates
      .filter((e) => e.form === "8-K" && e.basis === "8-K item 2.02" && e.announcedOn < p.picked.announcedOn)
      .filter((e) => !SEC.looksLikeEarlyNonResults(SEC.daysBetween(p.periodEnd, e.announcedOn), pattern))
      .sort((a, b) => (a.announcedOn < b.announcedOn ? 1 : -1));
    if (!earlier.length) continue;
    const keep = earlier[0];
    (pattern ? flips.pattern : flips.noPattern).push(
      `${symbol.padEnd(6)} ${p.periodEnd}  pick ${p.picked.announcedOn} ${p.picked.accession} (same day as 10-Q/10-K)` +
        `  ->  keep ${keep.announcedOn} ${keep.accession}  lags ${SEC.daysBetween(p.periodEnd, keep.announcedOn)}d vs ` +
        `${SEC.daysBetween(p.periodEnd, p.picked.announcedOn)}d${pattern ? `  cut ${(pattern.earlyLagDays + pattern.resultsLagDays) / 2}d` : ""}`);
  }

  // ── G ── causal: each period judged by the median of the periods before it.
  const chron = [...paired].sort((a, b) => (a.periodEnd < b.periodEnd ? -1 : 1));
  for (let i = 3; i < chron.length; i++) {
    const prior = SEC.median(chron.slice(0, i).map((p) => SEC.daysBetween(p.periodEnd, p.picked.announcedOn)));
    if (prior == null) continue;
    general.scored++;
    const lag = SEC.daysBetween(chron[i].periodEnd, chron[i].picked.announcedOn);
    if (lag < prior / 2) general.rejected.push(`${symbol} ${chron[i].periodEnd} results ${chron[i].picked.announcedOn} lag ${lag}d < ${prior / 2}d`);
  }

  // ── F ──
  if (isFpi) {
    const lags = (rec?.events ?? []).filter((e) => e?.periodEnd).length;
    if (lags >= MIN_USABLE) continue;
    const ends = [...new Set([...quarterEnds, ...yearEnds])].sort();
    const gaps = []; for (let i = 1; i < ends.length; i++) gaps.push(SEC.daysBetween(ends[i - 1], ends[i]));
    const step = SEC.median(gaps.filter((d) => d >= 60)) ?? null;
    const r = subs.filings.recent;
    const sixK = (r.form ?? []).filter((f) => f === "6-K" || f === "6-K/A").length;
    const annualForm = (r.form ?? []).filter((f) => f === "20-F" || f === "40-F").length;
    const reason = ends.length < MIN_USABLE ? "short history (fact set holds < 8 period ends)"
      : step != null && step >= 150 && step <= 200 ? "semiannual reporter"
      : step != null && step > 300 ? "annual-only in the fact set"
      : "6-K match gap (periods on file, 6-K reportDates do not land on them)";
    fpi.push({ symbol, reason, ends: ends.length, matched: lags, step, sixK, annualForm });
  }
}

console.log("=".repeat(78));
console.log("T. SAME-DAY TIE-BREAK — every period it would flip");
console.log(`paired periods ${pairedPeriods} · picks filed the same day as their 10-Q/10-K ${sameDayPicks}`);
console.log(`flips, filer WITH an early pattern (cut = own midpoint): ${flips.pattern.length}`);
for (const l of flips.pattern) console.log(`  ${l}`);
console.log(`flips, filer WITHOUT a pattern (no cut: any earlier original): ${flips.noPattern.length}`);
for (const l of flips.noPattern) console.log(`  ${l}`);

console.log("\n" + "=".repeat(78));
console.log("G. GENERAL RULE: lag < median(prior paired results lags) / 2 does not count");
console.log(`historical paired results releases scored: ${general.scored} · wrongly rejected: ${general.rejected.length}`);
for (const l of general.rejected) console.log(`  ${l}`);

console.log("\n" + "=".repeat(78));
console.log(`F. FPIs TOO THIN TO SCORE (< ${MIN_USABLE} matched periods): ${fpi.length}`);
const by = {};
for (const f of fpi) (by[f.reason] ??= []).push(f);
for (const [k, v] of Object.entries(by)) {
  console.log(`  ${k}: ${v.length}`);
  console.log(`    ${v.map((f) => `${f.symbol}(ends ${f.ends}, matched ${f.matched}, step ${f.step ?? "-"}d, 6-Ks ${f.sixK})`).join(" ")}`);
}
