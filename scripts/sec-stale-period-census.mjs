// WHY IS THE NEWEST STORED PERIOD OLDER THAN THE FILER'S NEWEST FILING?
//
// ── THE CASE THIS WAS BUILT FOR ──────────────────────────────────────────
// ABT's page read "Most recent quarter filed: Q1 FY2026 (period ending
// 2026-03-31)" on 16 September, and its reaction card stopped there — yet ABT
// announces its June quarter in July and files the 10-Q days later. The set had
// just been re-extracted from live companyfacts, so "stale cache" is not the
// answer and the question is which link is actually missing.
//
// FOUR THINGS, SIDE BY SIDE, for each symbol:
//   the stored set's newest quarter/year end and when it was written
//   the newest periodic filing in `submissions` (10-Q/10-K/20-F/40-F) and its
//     period-of-report
//   the newest Item 2.02 8-K
//   the stored report-date record's newest event
//
// Then the population count the review asked for: SYMBOLS whose stored newest
// period is more than 100 days old while submissions show a newer periodic
// filing. Counted in SYMBOLS. No writes.
import fs from "node:fs";
import { Redis } from "@upstash/redis";
import { readCodeOnly } from "./lib/source-code.mjs";
import { grabFunction, lift } from "./lib/earnings-plan.mjs";

const redis = Redis.fromEnv();
const UA = process.env.SEC_USER_AGENT ??
  "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; stale period census)";
const STALE_DAYS = Number(process.env.STALE_DAYS || 100);

const strip = (f) => readCodeOnly(f).replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "");
const sec = await lift(
  strip("lib/server/secReportDates.ts").replace(/export (const|function|type)/g, "$1") +
    "\nexport { reportEvents, daysBetween };"
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
const DATES_PREFIX = (
  fs.readFileSync("lib/server/secReportDatesStore.ts", "utf8")
    .match(/SEC_REPORT_DATES_PREFIX = "([^"]+)"/) ?? []
)[1];

const manifest = await redis.get(SEC_MANIFEST_KEY);
if (!manifest?.symbols) { console.error("FATAL: no manifest"); process.exit(2); }
const { map: tickerMap } = tick.parseTickerFile(
  fs.readFileSync("data/sec/company-tickers.json", "utf8")
);

const NAMED = (process.env.SYMBOLS || "").split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
const all = Object.entries(manifest.symbols).filter(([, e]) => e.cik).map(([s]) => s).sort();
const targets = NAMED.length ? NAMED : all;
const TODAY = new Date().toISOString().slice(0, 10);
console.log(`${targets.length} SYMBOLS · today ${TODAY} · stale threshold ${STALE_DAYS} days\n`);

let lastAt = 0;
const fetchJson = async (url) => {
  const wait = Math.max(0, lastAt + 125 - Date.now());
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastAt = Date.now();
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" } });
  if (!res.ok) return null;
  return res.json();
};

const PERIODIC = /^(10-K|10-Q|20-F|40-F)/;
const stale = [];
let read = 0, noSet = 0, noSubs = 0, current = 0;

for (const symbol of targets) {
  const cik = manifest.symbols[symbol]?.cik ?? tickerMap.get(symbol)?.cik;
  if (!cik) continue;
  const [set, rec] = await Promise.all([
    redis.get(`${SEC_FACTS_PREFIX}:${symbol}`),
    redis.get(`${DATES_PREFIX}:${symbol}`),
  ]);
  if (!set?.quarters) { noSet++; continue; }
  const ends = [...(set.quarters ?? []), ...(set.years ?? [])].map((p) => p.e).filter(Boolean).sort();
  const newestStored = ends[ends.length - 1] ?? null;
  if (!newestStored) { noSet++; continue; }
  const ageDays = sec.daysBetween(newestStored, TODAY);
  // CHEAP FIRST. A symbol whose newest stored period is recent cannot be the
  // case under investigation, and skipping it saves a submissions fetch.
  if (!NAMED.length && ageDays <= STALE_DAYS) { current++; continue; }

  const subs = await fetchJson(`https://data.sec.gov/submissions/CIK${cik}.json`);
  read++;
  if (!subs?.filings?.recent) { noSubs++; continue; }
  const r = subs.filings.recent;
  const n = r.accessionNumber?.length ?? 0;
  let newestPeriodic = null, newest202 = null;
  for (let i = 0; i < n; i++) {
    const form = String(r.form?.[i] ?? "");
    const filed = String(r.filingDate?.[i] ?? "");
    const period = String(r.reportDate?.[i] ?? "");
    if (PERIODIC.test(form) && (!newestPeriodic || filed > newestPeriodic.filed)) {
      newestPeriodic = { form, filed, period };
    }
    if (form.startsWith("8-K") && String(r.items?.[i] ?? "").includes("2.02") &&
        (!newest202 || filed > newest202.filed)) {
      newest202 = { form, filed, period };
    }
  }

  const recNewest = (rec?.events ?? [])[0];
  const line =
    `${symbol.padEnd(6)} stored newest ${newestStored} (${ageDays}d old, written ` +
    `${set.at ? new Date(set.at).toISOString().slice(0, 16).replace("T", " ") : "?"})\n` +
    `         newest periodic filing ${newestPeriodic ? `${newestPeriodic.form} filed ${newestPeriodic.filed} for period ${newestPeriodic.period}` : "none"}\n` +
    `         newest item 2.02 8-K   ${newest202 ? `filed ${newest202.filed}, event ${newest202.period}` : "none"}\n` +
    `         report-date record     ${rec ? `${rec.events.length} events, newest period ${recNewest?.periodEnd ?? "—"} announced ${recNewest?.announcedOn ?? "—"}, next ${rec.next?.kind}` : "none"}`;

  // THE POPULATION: a newer PERIODIC filing exists for a period the store does
  // not hold. A newer 8-K alone is not it — a results 8-K precedes the 10-Q,
  // and companyfacts follows the 10-Q.
  const missing = newestPeriodic && newestPeriodic.period && newestPeriodic.period > newestStored;
  if (missing) stale.push(line);
  // NAMED MODE PRINTS EVERY SYMBOL. The first version pushed the interesting
  // ones onto `stale` and printed only the others, so the one symbol the run
  // was dispatched for — the one that WAS stale — produced no output at all.
  if (NAMED.length) {
    console.log(line);
    console.log(`         MISSING A FILED PERIOD: ${missing ? "YES" : "no"}`);
    // ── AND WHY, which needs companyfacts itself ────────────────────────
    // "The 10-Q is filed" and "companyfacts carries the period" are different
    // facts, days apart, and only one of them is the extraction's problem.
    const facts = await fetchJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`);
    if (facts) {
      const want = newestPeriodic?.period ?? "";
      const hits = [];
      for (const [ns, tags] of Object.entries(facts.facts ?? {})) {
        for (const [tag, def] of Object.entries(tags)) {
          for (const rows of Object.values(def.units ?? {})) {
            for (const r of rows) {
              if (r.end !== want || !r.start) continue;
              const days = Math.round((Date.parse(r.end) - Date.parse(r.start)) / 86400000);
              hits.push(`${ns}:${tag} ${r.start}..${r.end} (${days}d, ${r.form} ${r.fp})`);
            }
          }
        }
      }
      // AND WHAT companyfacts DOES CARRY at its newest. "Zero frames ending on
      // that date" and "companyfacts stops before that date" are different
      // findings, and only the second one says the source is behind.
      const ends = new Set();
      for (const tags of Object.values(facts.facts ?? {})) {
        for (const def of Object.values(tags)) {
          for (const rows of Object.values(def.units ?? {})) {
            for (const r of rows) if (r.end && r.start) ends.add(r.end);
          }
        }
      }
      const newestEnds = [...ends].sort().slice(-6).reverse();
      console.log(`         companyfacts newest duration ends: ${newestEnds.join(" · ")}`);
      console.log(`         companyfacts frames ENDING ${want}: ${hits.length}`);
      for (const h of hits.slice(0, 8)) console.log(`           ${h}`);
      const stored = (set.quarters ?? []).slice(0, 6).map((q) => `${q.fp} FY${q.fy} ${q.e}`);
      console.log(`         stored quarters: ${stored.join(" · ")}`);

      // ── RULE THE PROBE OUT BEFORE BLAMING THE SOURCE ───────────────────
      // A count of zero can mean the period is absent OR that the counter is
      // looking in the wrong place. So the raw rows are printed for the two
      // tags every filer publishes — whichever revenue tag this one uses, and
      // NetIncomeLoss — with no filtering on end date at all. If the 10-Q's
      // six-month frame is there, it shows up here and the counter is wrong.
      const REVENUE_TAGS = ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax",
        "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueNet",
        "SalesRevenueGoodsNet"];
      for (const tag of [...REVENUE_TAGS, "NetIncomeLoss"]) {
        const def = facts.facts?.["us-gaap"]?.[tag];
        if (!def) continue;
        const rows = Object.values(def.units ?? {}).flat()
          .filter((r) => r.start)
          .sort((a, b) => (a.end < b.end ? 1 : a.end > b.end ? -1 : 0))
          .slice(0, 5);
        if (!rows.length) continue;
        console.log(`         us-gaap:${tag} — newest 5 duration rows:`);
        for (const r of rows) {
          const days = Math.round((Date.parse(r.end) - Date.parse(r.start)) / 86400000);
          console.log(`           ${r.start}..${r.end} (${days}d) form=${r.form} fy=${r.fy} fp=${r.fp} filed=${r.filed}`);
        }
      }
    }
    console.log("");
  }
}

if (!NAMED.length) {
  // THE COUNT LAST. A log tail is what gets read, and putting the answer above
  // a list of forty entries is how the last census had to be run twice.
  console.log("=".repeat(78));
  for (const l of stale.slice(0, 25)) console.log(l + "\n");
  if (stale.length > 25) console.log(`  ... and ${stale.length - 25} more\n`);
  console.log("=".repeat(78));
  console.log(`READ ${read} SYMBOLS from EDGAR (${current} skipped as current, ${noSet} no set, ${noSubs} no submissions)`);
  console.log(`STORED PERIOD MORE THAN ${STALE_DAYS} DAYS OLD *AND* A NEWER PERIODIC FILING EXISTS: ${stale.length} of ${targets.length} SYMBOLS`);
}
