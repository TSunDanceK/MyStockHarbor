// THE EARLY-2.02 MISPICK, MEASURED ACROSS THE UNIVERSE — and what it has
// already reached on production.
//
// ── WHAT THIS ANSWERS (review of #512/#513, 2026-09-22, items A, B, E) ────
//   A  per filer, per period: every original 8-K Item 2.02 between the period
//      end and the period's 10-Q/10-K. Where the EARLIEST is not the one
//      nearest the 10-Q, the stored record picked the wrong filing. Counts,
//      symbols, and each one's stored median lag against the lag the paired
//      rule produces.
//   B  what production shows today for TSLA and ABBV: the page text, the
//      session each reaction bar measures, and the due strip as it will read
//      on Oct 1-3 once the Q3 delivery 8-K lands (old rule vs paired rule).
//   E  FPI filers against the 0.80 and 0.70 bars, universe-wide.
//
// IT RUNS THE SHIPPED CODE. The paired rule is lifted from this ref's
// lib/server/secReportDates.ts; the OLD rule is the same module with the one
// line that finds the 10-Q forced to null -- which is exactly earliest-wins,
// and is the mutation check-sec-report-dates asserts is caught.
//
// READ-ONLY. GETs against Redis, data.sec.gov and the production site. The
// write- prefix on its relay task is the CREDENTIAL boundary (the store lives
// behind Upstash credentials only that job carries), not a claim that it writes.
//   relay task: write-early-202-census
import fs from "node:fs";
import { Redis } from "@upstash/redis";
import { readCodeOnly, grabConst } from "./lib/source-code.mjs";
import { lift, grabFunction } from "./lib/earnings-plan.mjs";

const redis = Redis.fromEnv();
const UA = process.env.SEC_USER_AGENT ??
  "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; early 2.02 census)";
const TODAY = process.env.TODAY || new Date().toISOString().slice(0, 10);
const FOCUS = (process.env.SYMBOLS || "TSLA,ABBV,ORCL,NVDA,MU")
  .split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);

const strip = (f) => readCodeOnly(f).replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "");
const RD_EXPORTS = "\nexport { resultsPairing, earlyNonResultsPattern, estimateUpcoming, nextPeriodEndFrom," +
  " latestResultsAnnouncement, pendingResults, reactionDate, daysBetween, median };";
const rdSrc = strip("lib/server/secReportDates.ts").replace(/export (const|function|type)/g, "$1");
const PAIR_LINE = "const filedOn = periodEnd ? periodic.get(periodEnd) ?? null : null;";
if (!rdSrc.includes(PAIR_LINE)) {
  console.error("FATAL: the pairing line is not in secReportDates.ts on this ref — the old rule cannot be derived from it.");
  process.exit(2);
}
const NEW = await lift(rdSrc + RD_EXPORTS, "", "secReportDatesPaired");
const OLD = await lift(rdSrc.replace(PAIR_LINE, "const filedOn = null as string | null;") + RD_EXPORTS, "", "secReportDatesEarliest");

// The due strip's selector and row label, lifted the way due-input-census does.
const rdFile = "lib/server/secReportDates.ts";
const dl = [grabConst(rdFile, "FILING_DEADLINE_DAYS"), grabConst(rdFile, "DEADLINE_FALLBACK"),
  grabFunction(readCodeOnly(rdFile), "deadlineDays")];
if (dl.some((x) => !x)) { console.error("FATAL: deadline table not grabbable"); process.exit(2); }
const DUE = await lift(
  dl.join("\n").replace(/^export /gm, "") + "\n" +
    strip("lib/server/dueToReport.ts").replace(/export (const|function|type)/g, "$1") +
    "\nexport { selectDue };", "", "dueToReport");
const STATE = await lift(
  strip("lib/server/dueStripState.ts").replace(/export (const|function|type)/g, "$1") +
    "\nexport { dueRowLabel };", "", "dueStripState");

const keyOf = (src, n) => (fs.readFileSync(src, "utf8").match(new RegExp(`${n} = "([^"]+)"`)) ?? [])[1];
const SEC_MANIFEST_KEY = keyOf("lib/server/secManifest.ts", "SEC_MANIFEST_KEY");
const SEC_FACTS_PREFIX = keyOf("lib/server/secManifest.ts", "SEC_FACTS_PREFIX");
const DATES_PREFIX = keyOf("lib/server/secReportDatesStore.ts", "SEC_REPORT_DATES_PREFIX");
const LIMIT = Number((fs.readFileSync("lib/server/secReportDatesStore.ts", "utf8")
  .match(/STORED_EVENT_LIMIT = (\d+)/) ?? [])[1] ?? 20);
for (const [n, v] of [["SEC_MANIFEST_KEY", SEC_MANIFEST_KEY], ["SEC_FACTS_PREFIX", SEC_FACTS_PREFIX], ["DATES_PREFIX", DATES_PREFIX]]) {
  if (!v) { console.error(`FATAL: could not read ${n}`); process.exit(2); }
}
const CUT = JSON.parse(fs.readFileSync("data/due-strip.json", "utf8")).symbols;

let lastAt = 0;
const fetchJson = async (url) => {
  const wait = Math.max(0, lastAt + 125 - Date.now());
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastAt = Date.now();
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" } });
      if (res.ok) return await res.json();
      if (res.status !== 429 && res.status < 500) return null;
    } catch { /* retried */ }
    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
  }
  return null;
};

const manifest = await redis.get(SEC_MANIFEST_KEY);
if (!manifest?.symbols) { console.error("FATAL: no manifest"); process.exit(2); }
const universe = Object.entries(manifest.symbols).filter(([, e]) => e?.cik).map(([s]) => s).sort();
console.log(`today ${TODAY} · universe ${universe.length} manifest symbols with a CIK · cut ${CUT.length}\n`);

// ── ONE PASS: record, fact set, submissions, both rules ───────────────────
const derive = (mod, subs, quarterEnds, yearEnds, today) => {
  const pairing = mod.resultsPairing(subs, new Set([...quarterEnds, ...yearEnds]));
  const events = pairing.events.filter((e) => e.periodEnd).slice(0, LIMIT);
  const cadence = mod.nextPeriodEndFrom(quarterEnds, yearEnds);
  const up = mod.estimateUpcoming(events, cadence, subs.category, today);
  const pattern = mod.earlyNonResultsPattern(pairing.periods);
  return { pairing, events, cadence, next: up.estimate, nextPeriodEnd: up.periodEnd, pattern };
};
const lagsOf = (events) => events
  .filter((e) => e.periodEnd && e.basis === "8-K item 2.02")
  .map((e) => NEW.daysBetween(e.periodEnd, e.announcedOn))
  .filter((d) => d >= 0 && d <= 200);

const rows = [];
const tally = { noRecord: 0, noFacts: 0, noSubs: 0, scored: 0 };
const cache = new Map();
for (const symbol of universe) {
  const cik = manifest.symbols[symbol].cik;
  const [rec, set] = await Promise.all([
    redis.get(`${DATES_PREFIX}:${symbol}`),
    redis.get(`${SEC_FACTS_PREFIX}:${symbol}`),
  ]);
  if (!rec) tally.noRecord++;
  if (!set?.quarters) { tally.noFacts++; continue; }
  const subs = await fetchJson(`https://data.sec.gov/submissions/CIK${cik}.json`);
  if (!subs?.filings?.recent) { tally.noSubs++; continue; }
  tally.scored++;
  const quarterEnds = set.quarters.map((p) => p.e).filter(Boolean);
  const yearEnds = (set.years ?? []).map((p) => p.e).filter(Boolean);
  const nu = derive(NEW, subs, quarterEnds, yearEnds, TODAY);
  const old = derive(OLD, subs, quarterEnds, yearEnds, TODAY);

  // THE REVIEW'S DEFINITION, per period: original 8-K 2.02s between the period
  // end and the 10-Q/10-K. "Mispicked" = more than one, and the earliest is not
  // the one nearest the 10-Q. Stored-window periods only (the 20 kept), so the
  // count is about what the record actually holds.
  const storedPeriods = new Set(nu.events.map((e) => e.periodEnd));
  const periods = nu.pairing.periods.filter((p) => storedPeriods.has(p.periodEnd) || old.events.some((e) => e.periodEnd === p.periodEnd));
  const mis = periods.filter((p) => p.rule === "paired" && p.picked.accession !== p.earliest.accession);
  const unpaired = periods.filter((p) => p.rule === "unpaired");

  // The fact set's own per-period filed date, where it has one — the question
  // "is a 10-Q date already stored anywhere a render reads".
  const factFiled = new Map([...set.quarters, ...(set.years ?? [])].filter((p) => p.e && p.f).map((p) => [p.e, p.f]));
  const factAgree = periods.filter((p) => p.periodicFiledOn && factFiled.has(p.periodEnd));
  const factSame = factAgree.filter((p) => factFiled.get(p.periodEnd) === p.periodicFiledOn).length;

  const storedLag = rec?.next?.kind === "date" ? rec.next.medianLagDays : NEW.median(lagsOf(rec?.events ?? []));
  const newLag = nu.next.kind === "date" ? nu.next.medianLagDays : NEW.median(lagsOf(nu.events));
  const row = {
    symbol, fpi: (rec?.events ?? []).some((e) => e?.basis === "6-K near period end"),
    periods: periods.length, paired: periods.length - unpaired.length, unpaired: unpaired.length,
    mis: mis.length, misPeriods: mis.map((p) => ({
      periodEnd: p.periodEnd, earliest: p.earliest.announcedOn, picked: p.picked.announcedOn, filed: p.periodicFiledOn,
    })),
    storedLag, newLag, storedKind: rec?.next?.kind ?? "no-record", newKind: nu.next.kind,
    storedNext: rec?.next?.kind === "date" ? rec.next.date : null, newNext: nu.next.kind === "date" ? nu.next.date : null,
    storedNextPeriodEnd: rec?.nextPeriodEnd ?? null, newNextPeriodEnd: nu.nextPeriodEnd,
    pattern: nu.pattern, factAgree: factAgree.length, factSame,
    rec, nu, old, subs, quarterEnds, yearEnds,
  };
  rows.push(row);
  if (FOCUS.includes(symbol) || CUT.includes(symbol)) cache.set(symbol, row);
}
console.log(`scored ${tally.scored} · no fact set ${tally.noFacts} · no submissions ${tally.noSubs} · no stored record ${tally.noRecord}\n`);

// ── A ─────────────────────────────────────────────────────────────────────
console.log("=".repeat(78));
console.log("A. THE MISPICK ACROSS THE UNIVERSE");
const affected = rows.filter((r) => r.mis > 0);
const totalPeriods = rows.reduce((n, r) => n + r.periods, 0);
const totalPaired = rows.reduce((n, r) => n + r.paired, 0);
console.log(`periods examined (in the stored window): ${totalPeriods} · paired with a 10-Q/10-K: ${totalPaired} · unpaired: ${totalPeriods - totalPaired}`);
console.log(`filers with >=1 period whose earliest 2.02 is NOT the one nearest the 10-Q/10-K: ${affected.length}`);
console.log(`periods covered: ${affected.reduce((n, r) => n + r.mis, 0)}`);
console.log(`...of which carry an early-non-results PATTERN (>=2 periods): ${affected.filter((r) => r.pattern).length}` +
  ` · a single incident: ${affected.filter((r) => !r.pattern).length}\n`);
console.log("symbol  mispicked/paired  stored lag -> paired lag   stored next        -> paired next        pattern");
for (const r of affected.sort((a, b) => b.mis - a.mis || (a.symbol < b.symbol ? -1 : 1))) {
  const pat = r.pattern ? `early ${r.pattern.earlyLagDays}d vs results ${r.pattern.resultsLagDays}d (${r.pattern.periods}/${r.pattern.ofPaired})` : "-";
  console.log(`${r.symbol.padEnd(7)} ${`${r.mis}/${r.paired}`.padEnd(17)} ${String(r.storedLag ?? "-").padStart(4)}d -> ${String(r.newLag ?? "-").padStart(4)}d        ` +
    `${`${r.storedKind} ${r.storedNext ?? ""}`.padEnd(18)} -> ${`${r.newKind} ${r.newNext ?? ""}`.padEnd(18)} ${pat}`);
}
console.log("\nper-period detail (earliest -> picked, 10-Q/10-K filed):");
for (const r of affected) {
  console.log(`  ${r.symbol.padEnd(6)} ` + r.misPeriods.map((p) => `${p.periodEnd}: ${p.earliest} -> ${p.picked} (Q ${p.filed})`).join(" · "));
}
const moved = rows.filter((r) => r.storedLag !== r.newLag || r.storedNextPeriodEnd !== r.newNextPeriodEnd);
console.log(`\nfilers whose lag or next period would move on a rewrite: ${moved.length}` +
  ` (of which not mispicked — drift since their record was written: ${moved.filter((r) => !r.mis).length})`);
console.log(`  mispicked: ${moved.filter((r) => r.mis).map((r) => r.symbol).join(" ") || "none"}`);
console.log("\nIS A 10-Q/10-K DATE ALREADY STORED WHERE A RENDER READS IT?");
const fa = rows.reduce((n, r) => n + r.factAgree, 0);
const fs2 = rows.reduce((n, r) => n + r.factSame, 0);
console.log(`  report-dates record: NO — events hold 8-K/6-K only; the 10-Q is read at write time from submissions and discarded.`);
console.log(`  fact set per-period 'f' (filed): present for ${fa} paired periods; equal to the submissions 10-Q/10-K date on ${fs2} (${fa ? ((100 * fs2) / fa).toFixed(1) : "-"}%).`);
console.log(`  -> the pairing runs in the cron where submissions are already in hand: no new field is needed for it; the affected records need a rewrite.`);

// ── B ─────────────────────────────────────────────────────────────────────
console.log("\n" + "=".repeat(78));
console.log("B. WHAT PRODUCTION SHOWS TODAY");
const htmlText = (html) => html
  .replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, "\n").replace(/&amp;/g, "&").replace(/&#x27;|&apos;|&#39;/g, "'").replace(/&quot;/g, '"')
  .replace(/&nbsp;/g, " ").split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
const page = async (path) => {
  try {
    const res = await fetch(`https://www.mystockharbor.com${path}`, { headers: { "User-Agent": "Mozilla/5.0 (MyStockHarbor census)" } });
    return { status: res.status, lines: htmlText(await res.text()) };
  } catch (e) { return { status: `ERR ${e.message}`, lines: [] }; }
};
const around = (lines, re, before = 0, after = 3, max = 12) => {
  const out = [];
  lines.forEach((l, i) => { if (re.test(l) && out.length < max) out.push(lines.slice(Math.max(0, i - before), i + after + 1).join(" | ")); });
  return out;
};
for (const sym of ["TSLA", "ABBV"]) {
  const r = cache.get(sym);
  const e = await page(`/stock/${sym}/earnings`);
  console.log(`\n/stock/${sym}/earnings  HTTP ${e.status}`);
  for (const l of around(e.lines, /^Next expected earnings date$/, 0, 3, 1)) console.log(`  NEXT: ${l}`);
  for (const l of around(e.lines, /Results filed with the SEC/, 1, 0, 10)) console.log(`  FILED: ${l}`);
  const s = await page(`/stock/${sym}`);
  console.log(`/stock/${sym}  HTTP ${s.status}`);
  for (const l of around(s.lines, /next (expected|report)|expected (earnings|to report)|Next earnings/i, 0, 2, 4)) console.log(`  NEXT: ${l}`);
  if (!r) continue;
  console.log(`  stored record: next=${JSON.stringify(r.rec?.next)} nextPeriodEnd=${r.rec?.nextPeriodEnd} pending=${JSON.stringify(r.rec?.pending ?? null)}`);
  console.log("  the session each reaction bar measures (stored events):");
  const early = r.nu.pattern;
  for (const ev of (r.rec?.events ?? []).slice(0, 8)) {
    const lag = NEW.daysBetween(ev.periodEnd, ev.announcedOn);
    const paired = r.nu.pairing.periods.find((p) => p.periodEnd === ev.periodEnd);
    const isResults = paired ? paired.picked.accession === ev.accession : null;
    console.log(`    ${ev.periodEnd}  filed ${ev.announcedOn} ${ev.announcedAt} ${ev.timing.padEnd(13)} -> session ${NEW.reactionDate(ev)}  lag ${String(lag).padStart(2)}d  ` +
      `${isResults === null ? "(unpaired)" : isResults ? "IS the results release" : `NOT the results — the release was ${paired.picked.announcedOn}`}`);
  }
  if (early) console.log(`  pattern: early ${early.earlyLagDays}d vs results ${early.resultsLagDays}d over ${early.periods}/${early.ofPaired} paired periods`);
}

// THE DUE STRIP ON OCT 1-3. Two worlds for each rule: the record as stored
// (the cron does not rewrite on an 8-K alone), and the record rewritten that
// day after the Q3 delivery 8-K landed (any fact-set change, the backfill, or
// a manual re-read would do it). The delivery 8-K is synthesised from the
// filer's own Q2 one, moved on a quarter.
console.log("\nTHE DUE STRIP, Oct 1-3 (cut of " + CUT.length + ")");
const synthDelivery = (row) => {
  const p = row.nu.pairing.periods.find((x) => x.rule === "paired" && x.earliest.accession !== x.picked.accession);
  if (!p) return null;
  const lag = NEW.daysBetween(p.periodEnd, p.earliest.announcedOn);
  const q3 = row.rec?.nextPeriodEnd ?? row.nu.nextPeriodEnd;
  if (!q3) return null;
  const on = new Date(Date.parse(q3) + lag * 86400000).toISOString().slice(0, 10);
  const rec = row.subs.filings.recent;
  const clone = JSON.parse(JSON.stringify(row.subs));
  const c = clone.filings.recent;
  for (const k of Object.keys(c)) if (Array.isArray(c[k])) c[k].unshift(null);
  c.accessionNumber[0] = "synthetic-q3-early-202";
  c.form[0] = "8-K"; c.items[0] = p.earliest.items ?? "2.02,9.01";
  c.reportDate[0] = on; c.filingDate && (c.filingDate[0] = on);
  c.acceptanceDateTime[0] = `${on}T${String(Number(p.earliest.announcedAt.slice(0, 2)) + 4).padStart(2, "0")}:${p.earliest.announcedAt.slice(3)}:00.000Z`;
  void rec;
  return { subs: clone, on };
};
for (const day of ["2026-10-01", "2026-10-02", "2026-10-03"]) {
  for (const [label, mod] of [["OLD (earliest)", OLD], ["PAIRED + guard", NEW]]) {
    for (const world of ["as stored", "rewritten after the 8-K"]) {
      const inputs = [];
      const notes = [];
      for (const sym of CUT) {
        const r = cache.get(sym);
        if (!r) continue;
        let rec;
        if (label.startsWith("OLD") && world === "as stored") rec = r.rec;
        else {
          const s = world === "as stored" ? null : synthDelivery(r);
          const subs = s && s.on <= day ? s.subs : r.subs;
          const d = derive(mod, subs, r.quarterEnds, r.yearEnds, day);
          const pending = mod.pendingResults(d.events, mod.latestResultsAnnouncement(subs), d.cadence, day,
            label.startsWith("OLD") ? null : d.pattern);
          rec = { nextPeriodEnd: d.nextPeriodEnd, next: d.next, category: subs.category, annual: d.cadence?.annual ?? null, pending };
          if (s && s.on <= day && ["TSLA", "ABBV"].includes(sym)) {
            notes.push(`${sym}: next ${d.next.kind === "date" ? d.next.date : d.next.kind} for ${d.nextPeriodEnd} · pending ${pending ? `${pending.periodEnd} "announced ${pending.announcedOn}"` : "none"}`);
          }
        }
        if (!rec?.nextPeriodEnd || rec?.next?.kind !== "date") continue;
        inputs.push({ symbol: sym, periodEnd: rec.nextPeriodEnd, medianLagDays: rec.next.medianLagDays,
          filerCategory: typeof rec.category === "string" ? rec.category : null,
          annual: typeof rec.annual === "boolean" ? rec.annual : true });
      }
      const due = DUE.selectDue(inputs, day);
      const pick = due.filter((e) => ["TSLA", "ABBV"].includes(e.symbol));
      console.log(`  ${day}  ${label.padEnd(15)} ${world.padEnd(24)} strip ${String(due.length).padStart(2)} rows: ${due.map((e) => e.symbol).join(" ") || "(none)"}`);
      for (const e of pick) console.log(`      ${e.symbol}: "${STATE.dueRowLabel(e)}"`);
      for (const n of notes) console.log(`      ${n}`);
    }
  }
}

// ── E ─────────────────────────────────────────────────────────────────────
console.log("\n" + "=".repeat(78));
console.log("E. FPI FILERS AGAINST THE BARS (universe, stored records, #512's own scorer)");
// expectedToReport.ts arrives with #512. On a ref that does not carry it yet,
// it is read from that branch rather than copied here -- a copy of the scorer
// would measure the copy.
let E;
try {
  const { execFileSync } = await import("node:child_process");
  const F = "lib/server/expectedToReport.ts";
  if (!fs.existsSync(F)) {
    execFileSync("git", ["fetch", "--depth", "1", "origin", "claude/expected-30d"], { stdio: "ignore" });
    fs.writeFileSync(F, execFileSync("git", ["show", `FETCH_HEAD:${F}`], { encoding: "utf8" }));
    console.log(`  (${F} read from origin/claude/expected-30d)`);
  }
  E = await lift(strip("lib/server/expectedToReport.ts").replace(/export (const|function|type)/g, "$1") +
    "\nexport { lagsFrom, filerPrecision, PRECISION_BAR_FPI, PRECISION_BAR_DOMESTIC };", "", "expectedToReport");
} catch (e) { E = null; console.log(`  expectedToReport.ts not liftable on this ref (${e.message}) — E skipped`); }
if (E) {
  const buckets = { clear080: [], clear070only: [], below: [], thin: [] };
  for (const r of rows) {
    const { lags, isFpi } = E.lagsFrom(r.rec?.events);
    if (!isFpi) continue;
    const sc = E.filerPrecision(lags);
    if (!sc) { buckets.thin.push(r.symbol); continue; }
    const tag = `${r.symbol}(${sc.precision.toFixed(2)})`;
    if (sc.precision >= E.PRECISION_BAR_FPI) buckets.clear080.push(tag);
    else if (sc.precision >= E.PRECISION_BAR_DOMESTIC) buckets.clear070only.push(tag);
    else buckets.below.push(tag);
  }
  const n = Object.values(buckets).reduce((a, b) => a + b.length, 0);
  console.log(`  FPI filers (any 6-K-basis event on the stored record): ${n}`);
  console.log(`  clear 0.80                  ${String(buckets.clear080.length).padStart(3)}  ${buckets.clear080.join(" ")}`);
  console.log(`  clear 0.70, not 0.80 (NVS)  ${String(buckets.clear070only.length).padStart(3)}  ${buckets.clear070only.join(" ")}`);
  console.log(`  below both                  ${String(buckets.below.length).padStart(3)}  ${buckets.below.join(" ")}`);
  console.log(`  too thin to score (<8)      ${String(buckets.thin.length).padStart(3)}`);
}

// ── THE BACKFILL LIST, for C.3 ────────────────────────────────────────────
console.log("\n" + "=".repeat(78));
console.log(`BACKFILL LIST (the mispicked filers, for data/sec/report-dates-rewrite.json): ${affected.length}`);
console.log(JSON.stringify(affected.map((r) => r.symbol).sort()));
