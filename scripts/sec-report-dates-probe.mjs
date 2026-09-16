// REPORT DATES AND TIMING FROM EDGAR, MEASURED AGAINST WHAT IS STORED.
//
// ── THE FOUR QUESTIONS ────────────────────────────────────────────────────
//   1. Is acceptanceDateTime Eastern wall time, or UTC? Everything else here
//      depends on it and it fails SILENTLY: read as UTC, every 16:31 release
//      becomes a 12:31 "during market" one, for every filer, forever.
//   2. Do the 8-K 2.02 dates agree with the dates already stored from FMP?
//      Counted in SYMBOLS and in FILINGS separately, because one filer with
//      forty disagreeing filings is a different problem from forty filers with
//      one each.
//   3. How far out is the next-date estimate? Backtested leave-one-out: predict
//      the most recent announcement from the median lag of the ones BEFORE it.
//   4. What does the 6-K rule actually catch? Reported apart from the 8-K
//      numbers, never blended — a 6-K carries no item codes and is selected by
//      a weaker rule.
//
// Credentialled (Upstash) to read the stored FMP rows; fetches EDGAR itself.
// NO WRITES.
import fs from "node:fs";
import { Redis } from "@upstash/redis";
import { readCodeOnly } from "./lib/source-code.mjs";
import { grabFunction, lift } from "./lib/earnings-plan.mjs";

const redis = Redis.fromEnv();
const UA = process.env.SEC_USER_AGENT ??
  "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; report date audit)";
const LIMIT = Number(process.env.LIMIT || 120);

// ── THE SHIPPED MODULE, LIFTED ───────────────────────────────────────────
const strip = (f) => readCodeOnly(f).replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "");
const sec = await lift(
  strip("lib/server/secReportDates.ts").replace(/export (const|function|type)/g, "$1") +
    "\nexport { reportEvents, estimateNextReport, parseAcceptanceEt, timingFor, daysBetween, median, deadlineDays };"
);
const tickSrc = readCodeOnly("lib/server/secTickerMap.ts");
const tick = await lift(
  [grabFunction(tickSrc, "padCik"), grabFunction(tickSrc, "parseTickerFile")].join("\n") +
    "\nexport { parseTickerFile, padCik };"
);

const manifestSrc = fs.readFileSync("lib/server/secManifest.ts", "utf8");
const pick = (name) => (manifestSrc.match(new RegExp(`${name} = "([^"]+)"`)) ?? [])[1];
const SEC_MANIFEST_KEY = pick("SEC_MANIFEST_KEY");
const SEC_FACTS_PREFIX = pick("SEC_FACTS_PREFIX");
const EARNINGS_PREFIX = (
  fs.readFileSync("lib/server/earningsStore.ts", "utf8")
    .match(/EARNINGS_REDIS_KEY_PREFIX = "([^"]+)"/) ?? []
)[1];
for (const [n, v] of [["SEC_MANIFEST_KEY", SEC_MANIFEST_KEY], ["SEC_FACTS_PREFIX", SEC_FACTS_PREFIX],
  ["EARNINGS_REDIS_KEY_PREFIX", EARNINGS_PREFIX]]) {
  if (!v) { console.error(`FATAL: could not read ${n}`); process.exit(2); }
}

const manifest = await redis.get(SEC_MANIFEST_KEY);
if (!manifest?.symbols) { console.error("FATAL: no manifest"); process.exit(2); }
const { map: tickerMap } = tick.parseTickerFile(
  fs.readFileSync("data/sec/company-tickers.json", "utf8")
);

const SYMBOLS = (process.env.SYMBOLS || "").split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
const targets = (SYMBOLS.length
  ? SYMBOLS
  : Object.entries(manifest.symbols).filter(([, e]) => e.cik).map(([s]) => s).sort()
).slice(0, LIMIT);
console.log(`${targets.length} SYMBOLS\n`);

const fetchJson = async (url) => {
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" } });
  if (!res.ok) return null;
  return res.json();
};

// ── 1. THE TIMEZONE, DECIDED BY MEASUREMENT ──────────────────────────────
//
// A PANEL WHOSE HABIT IS PUBLIC AND STABLE. Each of these has reported the same
// way for years, and the two readings put them in DIFFERENT buckets, so the
// panel discriminates rather than merely agreeing with both.
//
//   after close   AAPL MSFT NVDA GOOGL AMZN   (~16:00-16:30 ET)
//   before open   JPM KO PG CAT MMM           (~06:45-08:00 ET)
//
// Under the UTC reading every after-close filer moves to during-market (16:30Z
// = 12:30 ET) and every before-open filer moves to the small hours of the same
// date (07:00Z = 03:00 ET, still "before open" — so the after-close half is
// what actually decides it).
const PANEL = {
  "after-close": ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN"],
  "before-open": ["JPM", "KO", "PG", "CAT", "MMM"],
};

console.log("=".repeat(76));
console.log("1. IS acceptanceDateTime EASTERN WALL TIME, OR UTC?");
{
  const score = { "as-eastern": 0, "as-utc": 0 };
  let checked = 0;
  for (const [expected, syms] of Object.entries(PANEL)) {
    for (const symbol of syms) {
      const cik = tickerMap.get(symbol)?.cik;
      if (!cik) continue;
      const subs = await fetchJson(`https://data.sec.gov/submissions/CIK${cik}.json`);
      if (!subs) continue;
      const events = sec.reportEvents(subs);
      const ev = events[0];
      if (!ev) continue;
      // The RAW string behind that event, for the control arm.
      const recent = subs.filings.recent;
      const i = recent.accessionNumber.indexOf(ev.accession);
      const raw = i >= 0 ? recent.acceptanceDateTime[i] : null;
      if (!raw) continue;
      checked++;
      // AS SHIPPED: the raw instant converted UTC -> America/New_York.
      const asUtc = ev.timing;
      // THE ALTERNATIVE THIS REPLACED: the digits taken at face value as
      // Eastern. Kept as the control so the panel keeps DISCRIMINATING — a
      // probe that only ever runs the shipped reading cannot tell you it is
      // right, only that it is consistent with itself.
      const rawUtc = String(raw).match(/[T ](\d{2}):(\d{2})/);
      const asEastern = rawUtc
        ? sec.timingFor(Number(rawUtc[1]) * 60 + Number(rawUtc[2]))
        : null;
      if (asEastern === expected) score["as-eastern"]++;
      if (asUtc === expected) score["as-utc"]++;
      console.log(
        `  ${symbol.padEnd(6)} raw ${String(raw).slice(11, 16)}Z -> ${ev.announcedAt} ET  ` +
          `expected ${expected.padEnd(13)} as-utc(shipped)=${asUtc.padEnd(13)} as-eastern=${asEastern}`
      );
    }
  }
  console.log(`\n  PANEL: ${checked} filers checked`);
  console.log(`    reading the digits as EASTERN puts ${score["as-eastern"]}/${checked} in the expected bucket`);
  console.log(`    reading them as UTC and converting puts ${score["as-utc"]}/${checked} there`);
  console.log(`  => the shipped reading (UTC -> ET) is ${score["as-utc"] > score["as-eastern"] ? "SUPPORTED" : "NOT SUPPORTED"} by this panel`);
  if (score["as-utc"] < checked) {
    console.log(`  !! ${checked - score["as-utc"]} filer(s) did NOT land in the expected bucket under the shipped reading`);
  }
  console.log("");
}

// ── 2-4. THE CORPUS ──────────────────────────────────────────────────────
const agree = { symbols: new Set(), filings: 0 };
const disagree = { symbols: new Set(), filings: 0, examples: [] };
const noFmp = new Set();
const timingCounts = { "before-open": 0, "during-market": 0, "after-close": 0 };
const backtest = [];
const sixK = { symbols: new Set(), events: 0 };
let read = 0, noSubs = 0, noEvents = 0;

for (const symbol of targets) {
  const cik = manifest.symbols[symbol]?.cik ?? tickerMap.get(symbol)?.cik;
  if (!cik) continue;
  const subs = await fetchJson(`https://data.sec.gov/submissions/CIK${cik}.json`);
  if (!subs) { noSubs++; continue; }
  read++;

  // Period ends the STORED FACT SET knows about — the 6-K rule's input.
  const set = await redis.get(`${SEC_FACTS_PREFIX}:${symbol}`);
  const periodEnds = new Set([
    ...(set?.quarters ?? []).map((p) => p.e),
    ...(set?.years ?? []).map((p) => p.e),
  ].filter(Boolean));

  const events = sec.reportEvents(subs, periodEnds);
  if (!events.length) { noEvents++; continue; }
  for (const e of events) {
    timingCounts[e.timing]++;
    if (e.basis === "6-K near period end") { sixK.events++; sixK.symbols.add(symbol); }
  }

  // ── DATE AGREEMENT vs THE STORED FMP ROWS ──────────────────────────────
  // Stored EarningsRow has `date` and NO time-of-day field, so this compares
  // DATES only. bmo/amc cannot be compared from the store — see the report.
  const rows = (await redis.get(`${EARNINGS_PREFIX}${symbol}`)) ?? [];
  const fmpDates = new Set(rows.map((r) => r?.date).filter(Boolean));
  if (!fmpDates.size) { noFmp.add(symbol); continue; }
  for (const e of events) {
    // Only compare where FMP has an opinion about that period at all: an 8-K
    // older than FMP's window is not a disagreement.
    const near = [...fmpDates].some((d) => Math.abs(sec.daysBetween(d, e.announcedOn)) <= 1);
    const inRange = [...fmpDates].some((d) => Math.abs(sec.daysBetween(d, e.announcedOn)) <= 10);
    if (!inRange) continue;
    if (near) { agree.filings++; agree.symbols.add(symbol); }
    else {
      disagree.filings++;
      disagree.symbols.add(symbol);
      if (disagree.examples.length < 15) {
        const closest = [...fmpDates].sort(
          (a, b) => Math.abs(sec.daysBetween(a, e.announcedOn)) - Math.abs(sec.daysBetween(b, e.announcedOn))
        )[0];
        disagree.examples.push(`${symbol} SEC ${e.announcedOn} vs FMP ${closest} (${sec.daysBetween(closest, e.announcedOn)}d) ${e.basis}`);
      }
    }
  }

  // ── 3. LEAVE-ONE-OUT BACKTEST ──────────────────────────────────────────
  // Predict the MOST RECENT announcement using only the ones before it. A
  // median computed over the event it predicts is not a backtest.
  const dated = events.filter((e) => e.periodEnd);
  if (dated.length >= 4) {
    const actual = dated[0];
    const prior = dated.slice(1);
    const est = sec.estimateNextReport(prior, actual.periodEnd, subs.category, false);
    if (est) backtest.push({ symbol, error: Math.abs(sec.daysBetween(est.date, actual.announcedOn)), clamped: est.clamped });
  }
}

console.log("=".repeat(76));
console.log(`READ ${read} SYMBOLS (${noSubs} no submissions, ${noEvents} no qualifying filing)\n`);
console.log("2. 8-K/6-K ANNOUNCEMENT DATE vs THE STORED FMP DATE (±1 day = agreement)");
console.log(`   SYMBOLS:  ${agree.symbols.size} agree · ${disagree.symbols.size} have >=1 disagreement`);
console.log(`   FILINGS:  ${agree.filings} agree · ${disagree.filings} disagree`);
console.log(`   ${noFmp.size} SYMBOLS had no stored FMP rows to compare against`);
for (const ex of disagree.examples) console.log(`     ${ex}`);
console.log("");
console.log("   TIMING DISTRIBUTION (from acceptanceDateTime):");
for (const [k, v] of Object.entries(timingCounts)) console.log(`     ${k.padEnd(15)} ${v}`);
console.log("");
console.log("   bmo/amc AGREEMENT vs FMP: NOT MEASURED. The stored EarningsRow");
console.log("   carries `date` and no time-of-day field, and the runner has no");
console.log("   FMP_API_KEY, so there is nothing to compare the timing against.");
console.log("");
console.log("3. NEXT-DATE BACKTEST (leave-one-out, predict the newest from the rest)");
{
  const errs = backtest.map((b) => b.error);
  console.log(`   ${backtest.length} SYMBOLS with >=4 dated announcements`);
  console.log(`   median absolute error: ${sec.median(errs) ?? "n/a"} day(s)`);
  const within = (d) => errs.filter((e) => e <= d).length;
  console.log(`   within 0d ${within(0)} · 1d ${within(1)} · 3d ${within(3)} · 7d ${within(7)} of ${errs.length}`);
  console.log(`   clamped to the statutory deadline: ${backtest.filter((b) => b.clamped).length}`);
  const worst = [...backtest].sort((a, b) => b.error - a.error).slice(0, 8);
  for (const w of worst) console.log(`     worst: ${w.symbol} ${w.error}d${w.clamped ? " (clamped)" : ""}`);
}
console.log("");
console.log(`4. THE 6-K RULE: ${sixK.events} event(s) across ${sixK.symbols.size} SYMBOLS` +
  (sixK.symbols.size ? ` — ${[...sixK.symbols].sort().slice(0, 30).join(", ")}` : ""));
console.log("   Reported apart from the 8-K numbers above on purpose: a 6-K carries");
console.log("   no item codes and is selected positionally, which is weaker evidence.");
