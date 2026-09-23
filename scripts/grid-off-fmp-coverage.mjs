// THE GRID'S THREE FMP CALLS, MEASURED AGAINST THEIR FREE REPLACEMENTS. Reads only.
//
// Item 4 of claude/BRIEF-earnings-calendar-off-fmp-final-2026-09-22.md says to
// confirm coverage matches FMP's BEFORE cutover. This is that measurement, and it
// changes nothing. The denominator is what a reader actually sees today: the
// materialised day rows (msh:earnings-day-items:v1:<date>), which are FMP
// candidates that survived the name join, the symbol-shape filter and the
// US-listing admission test. FMP's raw month feed is counted beside it, so a
// "coverage" figure cannot quietly be taken against the wrong base.
//
//   candidates  FMP /stable/earnings-calendar      vs  secReportDatesStore events
//                                                      (announcedOn, exact and +-1 day)
//   names       FMP /stable/stock-list              vs  data/sec/company-tickers.json
//                                                      (company_tickers_exchange.json)
//   admission   FMP /stable/quote `exchange`        vs  price pool (usOk) and, as the
//                                                      alternative, the SEC file's own
//                                                      exchange column
//
// Price itself is not a replacement question any more: gridPriceCoverage.ts
// already hides price and market cap for every row outside the pool, so /quote's
// price only ever fed cells that are not rendered. What /quote still decides is
// admission, and that is what is measured.
//
//   relay task: write-grid-off-fmp-coverage  (credentialled for the read)
import fs from "node:fs";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
const src = (f) => fs.readFileSync(f, "utf8");
const constOf = (file, name) => (src(file).match(new RegExp(`${name} = "([^"]+)"`)) ?? [])[1];

const DATES_PREFIX = constOf("lib/server/secReportDatesStore.ts", "SEC_REPORT_DATES_PREFIX");
const DAY_ITEMS_PREFIX = constOf("lib/server/earningsCalendar.ts", "DAY_ITEMS_PREFIX");
const REF_PREFIX = constOf("lib/server/referenceCache.ts", "REFERENCE_KEY_PREFIX");
const POOL_KEY = constOf("lib/server/pricePool.ts", "PRICE_POOL_KEY");
const WINDOW_PAST_DAYS = Number((src("lib/server/earningsCalendar.ts").match(/WINDOW_PAST_DAYS = (\d+)/) ?? [])[1]);
for (const [k, v] of Object.entries({ DATES_PREFIX, DAY_ITEMS_PREFIX, REF_PREFIX, POOL_KEY, WINDOW_PAST_DAYS })) {
  if (!v) { console.error(`FATAL: ${k} not readable from source`); process.exit(2); }
}

// Same rule as earningsCalendar.looksNonUsOrDerivative, copied because it is
// three lines and this script must not import the module's Redis client.
const looksNonUs = (s) => s.includes(".") || s.includes("-") || (s.length >= 5 && /[YF]$/.test(s));

const DAY = 86_400_000;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const today = Date.parse(iso(Date.now()));
const dates = [];
for (let t = today - WINDOW_PAST_DAYS * DAY; t <= today; t += DAY) dates.push(iso(t));
const shift = (d, n) => iso(Date.parse(d) + n * DAY);

// ── SEC ticker file (names + exchange) ─────────────────────────────────────
const tf = JSON.parse(src("data/sec/company-tickers.json"));
const fi = (n) => tf.fields.indexOf(n);
const secTicker = new Map();
for (const r of tf.data) {
  const t = String(r[fi("ticker")] ?? "").toUpperCase();
  if (t && !secTicker.has(t)) secTicker.set(t, { name: r[fi("name")], exchange: r[fi("exchange")] });
}
const US_EXCH = new Set(["Nasdaq", "NYSE", "CBOE"]);

// ── SEC report-date records: every stored key ──────────────────────────────
const keys = [];
let cursor = "0";
do {
  const [next, batch] = await redis.scan(cursor, { match: `${DATES_PREFIX}:*`, count: 1000 });
  keys.push(...batch);
  cursor = String(next);
} while (cursor !== "0");
const secByDate = new Map(); // date -> Set(symbol)
const secSymbols = new Set();
let events = 0;
for (let i = 0; i < keys.length; i += 100) {
  const recs = await redis.mget(...keys.slice(i, i + 100));
  recs.forEach((rec, j) => {
    const sym = keys[i + j].slice(DATES_PREFIX.length + 1);
    if (!rec || !Array.isArray(rec.events)) return;
    secSymbols.add(sym);
    for (const e of rec.events) {
      const d = e.announcedOn || e.eventDate;
      if (!d) continue;
      events++;
      if (!secByDate.has(d)) secByDate.set(d, new Set());
      secByDate.get(d).add(sym);
    }
  });
}
const secOn = (d) => secByDate.get(d) ?? new Set();

// ── price pool membership ──────────────────────────────────────────────────
const poolSymbols = new Set((await redis.hkeys(POOL_KEY)).map((s) => s.toUpperCase()));

// ── FMP side: raw month feed + name map + materialised day rows ────────────
const months = [...new Set(dates.map((d) => d.slice(0, 7)))];
const fmpRawByDate = new Map();
for (const m of months) {
  const rows = await redis.get(`${REF_PREFIX}earnings-calendar:${m}`);
  console.log(`FMP month ${m}: ${Array.isArray(rows) ? rows.length + " rows in Redis" : "NOT IN REDIS (expired or never cached)"}`);
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r?.symbol || !r?.date) continue;
    if (!fmpRawByDate.has(r.date)) fmpRawByDate.set(r.date, new Set());
    fmpRawByDate.get(r.date).add(String(r.symbol).toUpperCase());
  }
}
const nameObj = await redis.get(`${REF_PREFIX}stock-list-names`);
const fmpNames = new Map(Object.entries(nameObj && typeof nameObj === "object" ? nameObj : {}));
console.log(`FMP stock-list names in Redis: ${fmpNames.size}`);

const shownByDate = new Map();
for (let i = 0; i < dates.length; i += 50) {
  const slice = dates.slice(i, i + 50);
  const vals = await redis.mget(...slice.map((d) => `${DAY_ITEMS_PREFIX}:${d}`));
  slice.forEach((d, j) => { if (Array.isArray(vals[j])) shownByDate.set(d, vals[j]); });
}

console.log(`\nwindow ${dates[0]} .. ${dates.at(-1)} (${dates.length} dates, WINDOW_PAST_DAYS=${WINDOW_PAST_DAYS})`);
console.log(`SEC report-date records: ${secSymbols.size} symbols, ${events} events`);
console.log(`price pool members: ${poolSymbols.size}`);
console.log(`SEC ticker file: ${secTicker.size} tickers (committed data/sec/company-tickers.json)`);

// ── 1. CANDIDATES ──────────────────────────────────────────────────────────
const tot = { shown: 0, exact: 0, pm1: 0, notInStore: 0, inStoreOtherDate: 0, secInWindow: 0, secNotShown: 0, fmpRaw: 0, fmpRawUsShape: 0, datesShown: 0 };
const shownPool = { n: 0, exact: 0, pm1: 0 };
const missSamples = [], extraSamples = [];
const perDate = [];
for (const d of dates) {
  const raw = fmpRawByDate.get(d) ?? new Set();
  tot.fmpRaw += raw.size;
  tot.fmpRawUsShape += [...raw].filter((s) => !looksNonUs(s) && fmpNames.has(s)).length;
  const sec = secOn(d);
  tot.secInWindow += sec.size;
  const items = shownByDate.get(d);
  if (!items) { perDate.push(`${d}  shown=—  sec=${sec.size}`); continue; }
  tot.datesShown++;
  const shown = new Set(items.map((x) => String(x.symbol).toUpperCase()));
  let ex = 0, pm = 0;
  for (const s of shown) {
    tot.shown++;
    const inPool = poolSymbols.has(s);
    if (inPool) shownPool.n++;
    if (sec.has(s)) { ex++; tot.exact++; if (inPool) shownPool.exact++; }
    if (sec.has(s) || secOn(shift(d, -1)).has(s) || secOn(shift(d, 1)).has(s)) { pm++; tot.pm1++; if (inPool) shownPool.pm1++; }
    else if (!secSymbols.has(s)) tot.notInStore++;
    else { tot.inStoreOtherDate++; if (missSamples.length < 25) missSamples.push(`${s}@${d}`); }
  }
  for (const s of sec) if (!shown.has(s)) { tot.secNotShown++; if (extraSamples.length < 25) extraSamples.push(`${s}@${d}`); }
  perDate.push(`${d}  shown=${shown.size}  sec=${sec.size}  both=${ex}  both±1=${pm}`);
}
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : "n/a");
console.log(`\n── 1. CANDIDATES (grid rows shown today vs SEC store) ──`);
console.log(`dates with materialised rows: ${tot.datesShown}/${dates.length}`);
console.log(`FMP raw feed rows in window: ${tot.fmpRaw} (of which US-shaped + named: ${tot.fmpRawUsShape})`);
console.log(`grid rows shown (denominator): ${tot.shown}`);
console.log(`  on SEC store, same date:   ${tot.exact}  ${pct(tot.exact, tot.shown)}`);
console.log(`  on SEC store, ±1 day:      ${tot.pm1}  ${pct(tot.pm1, tot.shown)}`);
console.log(`  missed, symbol not in store at all: ${tot.notInStore}  ${pct(tot.notInStore, tot.shown)}`);
console.log(`  missed, in store but no event within ±1 day: ${tot.inStoreOtherDate}  ${pct(tot.inStoreOtherDate, tot.shown)}`);
console.log(`restricted to pool members (the 700-universe rows): ${shownPool.n} shown · same date ${shownPool.exact} ${pct(shownPool.exact, shownPool.n)} · ±1 ${shownPool.pm1} ${pct(shownPool.pm1, shownPool.n)}`);
console.log(`SEC events in window on materialised dates but NOT shown by the grid: ${tot.secNotShown}`);
console.log(`  sample missed (in store, other date): ${missSamples.join(" ") || "none"}`);
console.log(`  sample SEC-only: ${extraSamples.join(" ") || "none"}`);

// ── 2. NAMES ───────────────────────────────────────────────────────────────
const shownSyms = new Set();
for (const items of shownByDate.values()) for (const x of items) shownSyms.add(String(x.symbol).toUpperCase());
const noSecName = [...shownSyms].filter((s) => !secTicker.get(s)?.name);
const secSyms = [...secSymbols];
console.log(`\n── 2. NAMES ──`);
console.log(`distinct shown symbols: ${shownSyms.size} · with a name in the SEC ticker file: ${shownSyms.size - noSecName.length} ${pct(shownSyms.size - noSecName.length, shownSyms.size)}`);
console.log(`  missing: ${noSecName.slice(0, 40).join(" ") || "none"}${noSecName.length > 40 ? ` … (+${noSecName.length - 40})` : ""}`);
console.log(`SEC-store symbols with a name in the ticker file: ${secSyms.filter((s) => secTicker.get(s)?.name).length}/${secSyms.length}`);

// ── 3. ADMISSION ───────────────────────────────────────────────────────────
const inPool = [...shownSyms].filter((s) => poolSymbols.has(s));
const secUs = [...shownSyms].filter((s) => US_EXCH.has(secTicker.get(s)?.exchange));
const eitherUs = [...shownSyms].filter((s) => poolSymbols.has(s) || US_EXCH.has(secTicker.get(s)?.exchange));
const exch = {};
for (const s of shownSyms) { const e = secTicker.get(s)?.exchange ?? "(not in file)"; exch[e] = (exch[e] ?? 0) + 1; }
console.log(`\n── 3. ADMISSION (shown symbols, all admitted today by FMP exchange or pool) ──`);
console.log(`admitted by price pool (usOk) alone:        ${inPool.length}/${shownSyms.size} ${pct(inPool.length, shownSyms.size)}`);
console.log(`admitted by SEC file exchange Nasdaq/NYSE/CBOE: ${secUs.length}/${shownSyms.size} ${pct(secUs.length, shownSyms.size)}`);
console.log(`admitted by either:                         ${eitherUs.length}/${shownSyms.size} ${pct(eitherUs.length, shownSyms.size)}`);
console.log(`SEC file exchange of shown symbols: ${JSON.stringify(exch)}`);
const secStoreUs = secSyms.filter((s) => poolSymbols.has(s) || US_EXCH.has(secTicker.get(s)?.exchange));
console.log(`SEC-store symbols admissible (pool or SEC exchange): ${secStoreUs.length}/${secSyms.length}`);

console.log(`\n── per date ──`);
for (const l of perDate) console.log(l);
console.log("\nNo writes were performed.");
