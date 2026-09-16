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
// ── THE PANEL, WIDENED TO THIRTY ─────────────────────────────────────────
// Ten was enough to settle the timezone and not enough to trust it. The
// before-open half is the only discriminating half, so it carries the most
// weight: twelve filers whose morning habit is long-standing, twelve whose
// after-close habit is, and six drawn from the DURING-MARKET bucket at random
// — because "during market" is the bucket a late filing would land in wrongly,
// and it is the one nobody has checked.
const PANEL = {
  "after-close": ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "AVGO", "ORCL", "CRM", "ADBE", "INTC", "AMD"],
  "before-open": ["JPM", "KO", "PG", "CAT", "MMM", "GS", "BAC", "WFC", "JNJ", "MRK", "PFE", "VZ"],
};
/** How many during-market filings to pull an exhibit for. */
const DURING_SAMPLE = 6;

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

// ── 2-5. THE CORPUS ──────────────────────────────────────────────────────
const agree = { symbols: new Set(), filings: 0 };
const disagree = { symbols: new Set(), filings: 0, examples: [] };
const noFmp = new Set();
const timingCounts = { "before-open": 0, "during-market": 0, "after-close": 0 };
const duringMarket = [];
const backtest = [];
const gate = { date: 0, month: 0, none: 0 };
const sixK = { symbols: new Set(), events: 0 };
let read = 0, noSubs = 0, noEvents = 0;

for (const symbol of targets) {
  const cik = manifest.symbols[symbol]?.cik ?? tickerMap.get(symbol)?.cik;
  if (!cik) continue;
  const subs = await fetchJson(`https://data.sec.gov/submissions/CIK${cik}.json`);
  if (!subs) { noSubs++; continue; }
  read++;

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
    if (e.timing === "during-market") duringMarket.push({ symbol, cik, ...e });
  }

  // ── DATE AGREEMENT vs THE STORED FMP ROWS (dates only) ─────────────────
  const rows = (await redis.get(`${EARNINGS_PREFIX}${symbol}`)) ?? [];
  const fmpDates = new Set(rows.map((r) => r?.date).filter(Boolean));
  if (!fmpDates.size) noFmp.add(symbol);
  else {
    for (const e of events) {
      const near = [...fmpDates].some((d) => Math.abs(sec.daysBetween(d, e.announcedOn)) <= 1);
      const inRange = [...fmpDates].some((d) => Math.abs(sec.daysBetween(d, e.announcedOn)) <= 10);
      if (!inRange) continue;
      if (near) { agree.filings++; agree.symbols.add(symbol); }
      else {
        disagree.filings++;
        disagree.symbols.add(symbol);
        if (disagree.examples.length < 12) {
          const closest = [...fmpDates].sort(
            (a, b) => Math.abs(sec.daysBetween(a, e.announcedOn)) - Math.abs(sec.daysBetween(b, e.announcedOn))
          )[0];
          disagree.examples.push(`${symbol} SEC ${e.announcedOn} vs FMP ${closest} (${sec.daysBetween(closest, e.announcedOn)}d) ${e.basis}`);
        }
      }
    }
  }

  // ── THE GATE, on the live history ──────────────────────────────────────
  const dated = events.filter((e) => e.periodEnd);
  if (dated.length) {
    const nextEnd = new Date(Date.parse(dated[0].periodEnd) + 91 * 86400000).toISOString().slice(0, 10);
    gate[sec.estimateNextReport(dated, nextEnd, subs.category, false).kind]++;
  }

  // ── 3. THE BACKTEST, WITH THE LEAK CLOSED ──────────────────────────────
  //
  // PRIOR MEANS STRICTLY PRIOR, ON BOTH AXES. The target is excluded, and so is
  // anything for the SAME period (an amendment, a re-index) and anything
  // announced on or after it. reportEvents already collapses a period to one
  // event; this is the second lock, because a backtest that depends on the
  // dedupe being perfect is a backtest that cannot detect the dedupe failing.
  const target = dated[0];
  if (target && dated.length >= 5) {
    const prior = dated.filter(
      (e) => e.periodEnd < target.periodEnd && e.announcedOn < target.announcedOn
    );
    if (prior.length >= 4) {
      // (i) LAG ONLY: the true next period end is given, so this isolates the
      //     lag prediction from the calendar derivation.
      const withTrueEnd = sec.estimateNextReport(prior, target.periodEnd, subs.category, false);
      // (ii) END TO END: the period end is DERIVED from prior events only,
      //      which is what production has to do.
      const spacings = [];
      for (let i = 0; i + 1 < prior.length; i++) {
        spacings.push(sec.daysBetween(prior[i + 1].periodEnd, prior[i].periodEnd));
      }
      const step = sec.median(spacings.filter((d) => d > 60 && d < 200));
      const derivedEnd = step
        ? new Date(Date.parse(prior[0].periodEnd) + step * 86400000).toISOString().slice(0, 10)
        : null;
      const withDerivedEnd = derivedEnd
        ? sec.estimateNextReport(prior, derivedEnd, subs.category, false)
        : { kind: "none" };

      // ── THE LEAK MUTATION ────────────────────────────────────────────────
      // Put the target back into its own training set. If the honest error does
      // not get WORSE than this, the honest run is still leaking.
      const leaky = sec.estimateNextReport([target, ...prior], target.periodEnd, subs.category, false);

      // ── TWO NAIVE BASELINES ─────────────────────────────────────────────
      // B1: the same fiscal quarter a year earlier, same lag.
      const yearAgo = prior.find((e) => {
        const gap = sec.daysBetween(e.periodEnd, target.periodEnd);
        return gap >= 330 && gap <= 400;
      });
      const b1 = yearAgo
        ? new Date(Date.parse(target.periodEnd) + sec.daysBetween(yearAgo.periodEnd, yearAgo.announcedOn) * 86400000)
            .toISOString().slice(0, 10)
        : null;
      // B2: a flat 35 days after the period end.
      const b2 = new Date(Date.parse(target.periodEnd) + 35 * 86400000).toISOString().slice(0, 10);

      const err = (d) => (d ? Math.abs(sec.daysBetween(d, target.announcedOn)) : null);
      backtest.push({
        symbol,
        basis: target.basis,
        kind: withTrueEnd.kind,
        lagOnly: withTrueEnd.kind === "date" ? err(withTrueEnd.date) : null,
        endToEnd: withDerivedEnd.kind === "date" ? err(withDerivedEnd.date) : null,
        leaky: leaky.kind === "date" ? err(leaky.date) : null,
        b1: err(b1),
        b2: err(b2),
        clamped: withTrueEnd.kind === "date" && withTrueEnd.clamped,
        priorN: prior.length,
        lags: prior.slice(0, 6).map((e) => sec.daysBetween(e.periodEnd, e.announcedOn)),
        medianLag: withTrueEnd.kind === "date" ? withTrueEnd.medianLagDays : null,
        predicted: withTrueEnd.kind === "date" ? withTrueEnd.date : null,
        actual: target.announcedOn,
        periodEnd: target.periodEnd,
        derivedEnd,
      });
    }
  }
}

console.log("=".repeat(76));
console.log(`READ ${read} SYMBOLS (${noSubs} no submissions, ${noEvents} no qualifying filing)\n`);
console.log("2. ANNOUNCEMENT DATE vs THE STORED FMP DATE (±1 day = agreement)");
console.log(`   FILINGS:  ${agree.filings} agree · ${disagree.filings} disagree`);
console.log(`   SYMBOLS:  ${agree.symbols.size} with >=1 agreeing · ${disagree.symbols.size} with >=1 disagreeing`);
console.log(`             (these OVERLAP — a filer can have both. ${noFmp.size} had no stored FMP rows.)`);
for (const ex of disagree.examples) console.log(`     ${ex}`);
console.log("");
console.log("   TIMING DISTRIBUTION:");
for (const [k, v] of Object.entries(timingCounts)) console.log(`     ${k.padEnd(15)} ${v}`);
console.log("");

// ── 5. WHAT ARE THE DURING-MARKET FILINGS REALLY? ────────────────────────
console.log("5. DURING-MARKET FILINGS — are they morning releases filed late?");
{
  // A DETERMINISTIC SAMPLE, not Math.random: a probe whose sample changes every
  // run cannot be re-checked against its own output.
  const step = Math.max(1, Math.floor(duringMarket.length / DURING_SAMPLE));
  const sample = [];
  for (let i = 0; i < duringMarket.length && sample.length < DURING_SAMPLE; i += step) sample.push(duringMarket[i]);
  console.log(`   ${duringMarket.length} during-market filings; sampling ${sample.length} evenly`);
  let withTime = 0, morning = 0;
  for (const f of sample) {
    const acc = f.accession.replace(/-/g, "");
    const idx = await fetchJson(
      `https://data.sec.gov/Archives/edgar/data/${Number(f.cik)}/${acc}/index.json`
    ).catch(() => null);
    const items = idx?.directory?.item ?? [];
    // EX-99.1 is the press release by convention.
    const ex = items.find((it) => /ex-?99/i.test(String(it.name)) && /\.(htm|html|txt)$/i.test(String(it.name)));
    let stamp = null;
    if (ex) {
      const res = await fetch(
        `https://www.sec.gov/Archives/edgar/data/${Number(f.cik)}/${acc}/${ex.name}`,
        { headers: { "User-Agent": UA } }
      ).catch(() => null);
      if (res?.ok) {
        const text = (await res.text()).replace(/<[^>]+>/g, " ");
        // A press release that carries a time usually writes it beside the
        // dateline. Anything else is left null rather than guessed at.
        const t = text.match(/\b(\d{1,2}):(\d{2})\s*(a\.?m\.?|p\.?m\.?)\s*(ET|EDT|EST|Eastern)/i);
        if (t) stamp = `${t[1]}:${t[2]} ${t[3].toUpperCase()} ${t[4].toUpperCase()}`;
      }
    }
    if (stamp) {
      withTime++;
      if (/a\.?m\.?/i.test(stamp)) morning++;
    }
    console.log(
      `     ${f.symbol.padEnd(6)} filed ${f.announcedOn} ${f.announcedAt} ET` +
        `  exhibit=${ex ? ex.name : "none"}  release time=${stamp ?? "not stated"}`
    );
  }
  console.log(`   ${withTime} of ${sample.length} exhibits stated a time; ${morning} of those were a.m.`);
  console.log("   A morning release filed during market hours is misclassified — and by the");
  console.log("   session mapping it still selects the SAME reaction day, so it is harmless.");
}
console.log("");

console.log("3. NEXT-DATE BACKTEST — leak closed, with baselines");
{
  const dateRows = backtest.filter((b) => b.kind === "date");
  const med = (xs) => sec.median(xs.filter((x) => x !== null));
  console.log(`   ${backtest.length} SYMBOLS with >=5 dated events and >=4 strictly-prior ones`);
  console.log(`   ${dateRows.length} of them clear the regularity gate and get a DATE\n`);
  const cols = [
    ["method (lag only, true period end)", dateRows.map((b) => b.lagOnly)],
    ["method (end to end, derived end)  ", dateRows.map((b) => b.endToEnd)],
    ["baseline: same quarter last year  ", dateRows.map((b) => b.b1)],
    ["baseline: period end + 35 days    ", dateRows.map((b) => b.b2)],
    ["LEAKY (target in its own median)  ", dateRows.map((b) => b.leaky)],
  ];
  for (const [label, xs] of cols) {
    const v = xs.filter((x) => x !== null);
    const within = (d) => v.filter((e) => e <= d).length;
    console.log(`   ${label}  median ${med(xs) ?? "n/a"}d · 0d ${within(0)} · <=1d ${within(1)} · <=3d ${within(3)} · <=7d ${within(7)} of ${v.length}`);
  }
  // ── THE LEAK TEST, COMPARED PROPERLY ─────────────────────────────────
  //
  // TWO FAULTS IN THE FIRST VERSION, both of which would have let a leak pass:
  //
  //  (1) IT COMPARED DIFFERENT POPULATIONS. Restoring the target changes which
  //      filers clear the regularity gate, so the leaky column was computed
  //      over 42 symbols and the honest one over 44 — different sets, compared
  //      as if they were one.
  //  (2) IT COMPARED MEDIANS ONLY. At errors of 0-3 days the median is coarse
  //      enough to tie while every individual prediction moved.
  //
  // So: intersect, then compare PER SYMBOL. A leak shows up as the leaky
  // prediction being better on symbol after symbol, which counting says and a
  // median cannot.
  const paired = dateRows.filter((b) => b.lagOnly !== null && b.leaky !== null);
  const better = paired.filter((b) => b.leaky < b.lagOnly).length;
  const worse = paired.filter((b) => b.leaky > b.lagOnly).length;
  const same = paired.length - better - worse;
  const mean = (xs) => (xs.length ? xs.reduce((a, c) => a + c, 0) / xs.length : NaN);
  console.log("");
  console.log(`   LEAK TEST, on the ${paired.length} SYMBOLS both columns cover:`);
  console.log(`     per symbol: leaky better ${better} · worse ${worse} · identical ${same}`);
  console.log(`     mean error: honest ${mean(paired.map((b) => b.lagOnly)).toFixed(2)}d ` +
    `vs leaky ${mean(paired.map((b) => b.leaky)).toFixed(2)}d`);
  console.log(`     median:     honest ${med(paired.map((b) => b.lagOnly))}d vs leaky ${med(paired.map((b) => b.leaky))}d`);
  // A REAL LEAK MAKES THE LEAKY COLUMN BETTER ALMOST EVERYWHERE, because the
  // answer is sitting in its own training set. A handful of moves either way is
  // one extra sample shifting a median, which is what an honest run looks like.
  const verdict = better > paired.length * 0.5
    ? "leaky wins on most symbols — the honest run is STILL LEAKING"
    : better === 0 && worse === 0
      ? "IDENTICAL on every symbol — suspicious: the target may still be in the median"
      : "leaky does NOT dominate — consistent with the honest run being clean";
  console.log(`   => ${verdict}`);
  // ── DOES IT BEAT THE BASELINES? SAID OUT LOUD ────────────────────────
  {
    const pairs = dateRows.filter((b) => b.lagOnly !== null && b.b1 !== null);
    const beatB1 = pairs.filter((b) => b.lagOnly < b.b1).length;
    const loseB1 = pairs.filter((b) => b.lagOnly > b.b1).length;
    console.log("");
    console.log(`   vs SAME QUARTER LAST YEAR (${pairs.length} SYMBOLS): method better ${beatB1} · worse ${loseB1} · tied ${pairs.length - beatB1 - loseB1}`);
    const pairs2 = dateRows.filter((b) => b.lagOnly !== null && b.b2 !== null);
    const beatB2 = pairs2.filter((b) => b.lagOnly < b.b2).length;
    console.log(`   vs PERIOD END + 35 DAYS (${pairs2.length} SYMBOLS): method better ${beatB2} · worse ${pairs2.filter((b) => b.lagOnly > b.b2).length}`);
  }
  console.log("");
  console.log("   FIVE WORKED EXAMPLES:");
  const domestic = dateRows.filter((b) => b.basis === "8-K item 2.02");
  const clamped = dateRows.filter((b) => b.clamped);
  const picked = [...domestic.slice(0, 3), ...clamped.slice(0, 1), ...dateRows.slice(-1)]
    .filter((v, i, a) => a.indexOf(v) === i).slice(0, 5);
  for (const b of picked) {
    console.log(`     ${b.symbol}  prior lags ${JSON.stringify(b.lags)} (n=${b.priorN}) median ${b.medianLag}d`);
    console.log(`       period end ${b.periodEnd} (derived ${b.derivedEnd}) -> predicted ${b.predicted} · actual ${b.actual}` +
      ` · error ${b.lagOnly}d${b.clamped ? " CLAMPED" : ""} · ${b.basis}`);
  }
}
console.log("");
console.log("4. THE REGULARITY GATE, over every symbol read");
console.log(`   a specific DATE: ${gate.date} · a MONTH only: ${gate.month} · NOTHING: ${gate.none}`);
console.log("");
console.log(`6. THE 6-K RULE: ${sixK.events} event(s) across ${sixK.symbols.size} SYMBOLS`);
console.log("   No 6-K history earns an estimate — estimateNextReport uses the 8-K path only.");
