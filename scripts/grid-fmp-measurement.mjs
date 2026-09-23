// THE EARNINGS GRID'S THREE FMP CALLS, MEASURED AGAINST SEC AND THE PRICE POOL.
//
// ── WHAT THIS ANSWERS (claude/grid-fmp-measurement-2026-09-23.md) ─────────
//   A  candidates  /stable/earnings-calendar -> the (symbol, date) pairs the
//                  grid shows, against the SEC record's Item 2.02 / 6-K results
//                  events for the same window. Overlap, FMP-only with a reason,
//                  SEC-only with a reason, and date agreement on the overlap.
//   B  names       /stable/stock-list -> the grid's company column, against
//                  SEC's company_tickers_exchange title and the stored fact
//                  set's entityName.
//   C  admission   /stable/quote's `exchange` -> the US-listed test, against
//                  the price pool (usOk) and SEC's exchange column.
//
// ── WHERE THE FMP SIDE COMES FROM, AND WHY NOWHERE ELSE ──────────────────
// No FMP key is in the relay environment, deliberately. Every FMP number below
// is read out of what production ALREADY CACHED in Redis:
//   msh:reference:v1:earnings-calendar:YYYY-MM   the raw month rows
//                                                (fetchMonthRowsDetailed)
//   msh:reference:v1:stock-list-names            the name map (getNameMap)
//   msh:earnings-day-items:v1:<date>             the grid's own materialised rows
//   msh:earnings-day-complete:v3:<date>          whether that date settled
// FMP quote's `exchange` is NOT cached anywhere (it lives in Next's per-instance
// fetch cache only), so it is inferred from the one place it leaves a trace: a
// row admitted WITHOUT a pool hit was admitted by the exchange test. Where a
// reading is absent the script says so rather than estimating.
//
// ── THE CANDIDATE LIST IS BUILT BY THE SHIPPED FUNCTION ──────────────────
// getMonthCandidates is lifted out of lib/server/earningsCalendar.ts with its
// two readers stubbed to return what Redis holds, so the name join, the
// symbol-shape filter and the one-row-per-symbol-per-month collapse are the
// production code's, not a re-reading of it. popularRank is stubbed to 0: it
// orders a date's list and never removes anything.
//
// READ-ONLY. GETs / MGET / HMGET / TTL against Redis, and GETs against
// www.sec.gov and data.sec.gov. The write- prefix on its relay task is the
// CREDENTIAL boundary (Redis lives behind credentials only that job carries),
// not a claim that it writes. Nothing is written anywhere.
//   relay task: write-grid-fmp-measurement
import fs from "node:fs";
import { Redis } from "@upstash/redis";
import { readCodeOnly } from "./lib/source-code.mjs";
import { lift, grabFunction } from "./lib/earnings-plan.mjs";

const redis = Redis.fromEnv();
const UA = process.env.SEC_USER_AGENT ??
  "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; earnings grid measurement)";
const TODAY = process.env.TODAY || "2026-09-23";
const WINDOW_DAYS = 60;
const MATCH_TOL = 10; // days either side a FMP date and a SEC event may pair
const SHOW = 25; // examples per list

const DAY = 86_400_000;
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const diffDays = (a, b) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY);
const FROM = addDays(TODAY, -(WINDOW_DAYS - 1));
const DATES = [];
for (let d = FROM; d <= TODAY; d = addDays(d, 1)) DATES.push(d);
const inWindow = (d) => typeof d === "string" && d >= FROM && d <= TODAY;

// ── KEYS, READ FROM THE SOURCE rather than retyped ─────────────────────────
const keyOf = (src, n) => (fs.readFileSync(src, "utf8").match(new RegExp(`${n} = "([^"]+)"`)) ?? [])[1];
const K = {
  REFERENCE: keyOf("lib/server/referenceCache.ts", "REFERENCE_KEY_PREFIX"),
  DAY_ITEMS: keyOf("lib/server/earningsCalendar.ts", "DAY_ITEMS_PREFIX"),
  DAY_COMPLETE: keyOf("lib/server/earningsCalendar.ts", "DAY_COMPLETE_PREFIX"),
  POOL: keyOf("lib/server/pricePool.ts", "PRICE_POOL_KEY"),
  MANIFEST: keyOf("lib/server/secManifest.ts", "SEC_MANIFEST_KEY"),
  FACTS: keyOf("lib/server/secManifest.ts", "SEC_FACTS_PREFIX"),
  DATES: keyOf("lib/server/secReportDatesStore.ts", "SEC_REPORT_DATES_PREFIX"),
};
for (const [n, v] of Object.entries(K)) if (!v) { console.error(`FATAL: key ${n} not readable from source`); process.exit(2); }
const ALLOWED = (fs.readFileSync("lib/server/earningsCalendar.ts", "utf8")
  .match(/ALLOWED_EXCHANGES = new Set\(\[([^\]]+)\]\)/) ?? [])[1];
if (!ALLOWED) { console.error("FATAL: ALLOWED_EXCHANGES not readable"); process.exit(2); }

// ── THE SHIPPED CANDIDATE BUILDER ──────────────────────────────────────────
const ec = readCodeOnly("lib/server/earningsCalendar.ts");
const parts = ["getMonthCandidates", "looksNonUsOrDerivative", "candidateDataScore", "num", "str", "monthKey"]
  .map((n) => [n, grabFunction(ec, n)]);
for (const [n, body] of parts) if (!body) { console.error(`FATAL: ${n} not liftable`); process.exit(2); }
const LIFT = await lift(
  parts.map(([, b]) => b.replace(/^export /, "")).join("\n") +
    "\nexport { getMonthCandidates, looksNonUsOrDerivative };",
  "const MONTH_CACHE_MS = 0; const candidatesCache = new Map(); const popularRank = (_s) => 0;\n" +
    "let __rows = []; let __names = new Map();\n" +
    "export const __set = (rows, names) => { __rows = rows; __names = names; };\n" +
    "const fetchMonthRows = async (_y, _m) => __rows; const getNameMap = async () => __names;",
  "getMonthCandidates",
);

// ── SMALL HELPERS ──────────────────────────────────────────────────────────
const chunk = (xs, n) => { const out = []; for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n)); return out; };
const mgetAll = async (keys, n = 50) => {
  const out = [];
  for (const c of chunk(keys, n)) out.push(...((await redis.mget(...c)) ?? c.map(() => null)));
  return out;
};
const tally = (xs) => xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map());
const fmtTally = (m) => [...m].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${v}`).join(" · ");
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : "n/a");
const ex = (xs, n = SHOW) => (xs.length ? xs.slice(0, n).join(", ") + (xs.length > n ? ` … (+${xs.length - n})` : "") : "none");

let lastAt = 0;
const fetchSec = async (url, asText = false) => {
  const wait = Math.max(0, lastAt + 125 - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastAt = Date.now();
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" } });
      if (res.ok) return asText ? await res.text() : await res.json();
      if (res.status !== 429 && res.status < 500) return null;
    } catch { /* retried */ }
    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
  }
  return null;
};

console.log(`window ${FROM} .. ${TODAY} (${DATES.length} days) · match tolerance ±${MATCH_TOL}d · allowed exchanges [${ALLOWED}]`);

// ════════════════════════════════════════════════════════════════════════════
// 0. INVENTORY — what production has cached, and for how long
// ════════════════════════════════════════════════════════════════════════════
console.log("\n== 0. INVENTORY (Redis) ==");
const months = [...new Set(DATES.map((d) => d.slice(0, 7)))];
const monthRows = new Map();
for (const m of months) {
  const key = `${K.REFERENCE}earnings-calendar:${m}`;
  const [rows, ttl] = await Promise.all([redis.get(key), redis.ttl(key)]);
  monthRows.set(m, Array.isArray(rows) ? rows : null);
  const dates = Array.isArray(rows) ? rows.map((r) => String(r?.date ?? "").slice(0, 10)).filter(Boolean).sort() : [];
  console.log(`  ${key}: ${Array.isArray(rows) ? `${rows.length} rows, dates ${dates[0]}..${dates.at(-1)}` : "ABSENT"} · ttl ${ttl}s`);
}
const namesKey = `${K.REFERENCE}stock-list-names`;
const [namesRaw, namesTtl] = await Promise.all([redis.get(namesKey), redis.ttl(namesKey)]);
const nameMap = namesRaw && typeof namesRaw === "object" ? new Map(Object.entries(namesRaw)) : null;
console.log(`  ${namesKey}: ${nameMap ? `${nameMap.size} names` : "ABSENT"} · ttl ${namesTtl}s`);

const dayItems = await mgetAll(DATES.map((d) => `${K.DAY_ITEMS}:${d}`), 10);
const dayComplete = await mgetAll(DATES.map((d) => `${K.DAY_COMPLETE}:${d}`));
const dayTtl = [];
for (const d of [DATES[0], DATES[Math.floor(DATES.length / 2)], DATES.at(-1)]) dayTtl.push(`${d}=${await redis.ttl(`${K.DAY_ITEMS}:${d}`)}s`);
const dayState = DATES.map((d, i) => ({
  date: d,
  items: Array.isArray(dayItems[i]) ? dayItems[i] : null,
  complete: dayComplete[i] != null,
}));
console.log(`  ${K.DAY_ITEMS}:<date>: present ${dayState.filter((x) => x.items).length}/${DATES.length} · complete-flag ${dayState.filter((x) => x.complete).length}/${DATES.length} · sample ttl ${dayTtl.join(" ")}`);
console.log(`  dates with no blob: ${ex(dayState.filter((x) => !x.items).map((x) => x.date), 70)}`);
console.log(`  dates with blob but NOT complete: ${ex(dayState.filter((x) => x.items && !x.complete).map((x) => `${x.date}(${x.items.length})`), 70)}`);
const poolLen = await redis.hlen(K.POOL);
console.log(`  ${K.POOL}: ${poolLen} fields`);
const manifest = await redis.get(K.MANIFEST);
const manifestSyms = manifest?.symbols ? Object.keys(manifest.symbols) : [];
console.log(`  ${K.MANIFEST}: ${manifestSyms.length} symbols, ${manifestSyms.filter((s) => manifest.symbols[s]?.cik).length} with a CIK`);

// ── SEC's ticker file, live, and the committed copy ────────────────────────
const parseTickers = (json) => {
  const out = new Map();
  if (!json?.fields || !Array.isArray(json.data)) return out;
  const at = (n) => json.fields.indexOf(n);
  const [ci, ni, ti, xi] = ["cik", "name", "ticker", "exchange"].map(at);
  for (const row of json.data) {
    const t = String(row[ti] ?? "").toUpperCase();
    if (t && !out.has(t)) out.set(t, { cik: String(row[ci]).padStart(10, "0"), title: row[ni] ?? null, exchange: row[xi] || null });
  }
  return out;
};
const liveTickers = parseTickers(await fetchSec("https://www.sec.gov/files/company_tickers_exchange.json"));
const committedTickers = parseTickers(JSON.parse(fs.readFileSync("data/sec/company-tickers.json", "utf8").replace(/^[^{]*/, "")));
const tickers = liveTickers.size >= 5000 ? liveTickers : committedTickers;
console.log(`  SEC company_tickers_exchange: live ${liveTickers.size} · committed ${committedTickers.size} · using ${tickers === liveTickers ? "LIVE" : "COMMITTED"}`);
// SEC spells share classes with a dash (BRK-B); FMP with a dash too. A dot is
// tried as a fallback so a spelling difference is not reported as "no CIK".
const tick = (s) => tickers.get(s) ?? tickers.get(s.replace(/\./g, "-")) ?? tickers.get(s.replace(/-/g, ".")) ?? null;

// ════════════════════════════════════════════════════════════════════════════
// FMP SIDE — raw rows, candidates (shipped builder), grid rows (materialised)
// ════════════════════════════════════════════════════════════════════════════
const rawPairs = new Map(); // symbol -> Set(date) for raw FMP rows in window
let candidates = null; // Map date -> [candidate]
const dropped = { noName: new Set(), shape: new Set() };
if ([...monthRows.values()].every(Boolean) && nameMap) {
  candidates = new Map();
  for (const m of months) {
    const rows = monthRows.get(m);
    for (const r of rows) {
      const s = String(r?.symbol ?? "").trim().toUpperCase();
      const d = String(r?.date ?? "").slice(0, 10);
      if (!s || !inWindow(d)) continue;
      if (!rawPairs.has(s)) rawPairs.set(s, new Set());
      rawPairs.get(s).add(d);
      if (!nameMap.get(s)) dropped.noName.add(s);
      else if (LIFT.looksNonUsOrDerivative(String(r.symbol).trim())) dropped.shape.add(s);
    }
    LIFT.__set(rows, nameMap);
    const [y, mo] = m.split("-").map(Number);
    const byDate = await LIFT.getMonthCandidates(y, mo);
    for (const [d, list] of byDate) if (inWindow(d)) candidates.set(d, list);
  }
}
const candPairs = candidates ? [...candidates].flatMap(([d, l]) => l.map((c) => ({ symbol: c.symbol.toUpperCase(), date: d, company: c.company }))) : [];

const gridRows = dayState.flatMap((x) => (x.items ?? []).map((it) => ({ ...it, symbol: String(it.symbol).toUpperCase(), date: x.date, complete: x.complete })));
const gridSyms = [...new Set(gridRows.map((r) => r.symbol))].sort();
console.log("\n== FMP SIDE ==");
console.log(`  raw FMP rows in window: ${candidates ? `${[...rawPairs.values()].reduce((a, s) => a + s.size, 0)} (symbol,date) pairs over ${rawPairs.size} symbols` : "NOT MEASURABLE (a month or the name map is absent from Redis)"}`);
if (candidates) {
  console.log(`  dropped before quoting: no stock-list name ${dropped.noName.size} symbols · symbol-shape filter ${dropped.shape.size} symbols`);
  console.log(`  grid candidates (shipped getMonthCandidates): ${candPairs.length} pairs over ${new Set(candPairs.map((c) => c.symbol)).size} symbols`);
}
console.log(`  grid rows (materialised day-items): ${gridRows.length} rows over ${gridSyms.length} symbols; on complete dates ${gridRows.filter((r) => r.complete).length}`);

// ════════════════════════════════════════════════════════════════════════════
// SEC SIDE — the stored record (manifest universe) + live submissions
// ════════════════════════════════════════════════════════════════════════════
const manifestSet = new Set(manifestSyms);
const recs = await mgetAll(manifestSyms.map((s) => `${K.DATES}:${s}`));
const store = new Map(); // symbol -> { at, events in window }
manifestSyms.forEach((s, i) => {
  const r = recs[i];
  if (!r || !Array.isArray(r.events)) return;
  store.set(s, { at: r.at, all: r.events, events: r.events.filter((e) => inWindow(e?.announcedOn)) });
});
const storeEvents = [...store].flatMap(([s, r]) => r.events.map((e) => ({ symbol: s, date: e.announcedOn, basis: e.basis, items: e.items })));
console.log("\n== SEC SIDE ==");
console.log(`  report-dates records: ${store.size}/${manifestSyms.length} manifest symbols · events in window ${storeEvents.length} (${fmtTally(tally(storeEvents.map((e) => e.basis)))}) over ${new Set(storeEvents.map((e) => e.symbol)).size} symbols`);

// Live submissions for every symbol either side touches, so each unmatched row
// can be given a reason from the filer's own record.
const rdSrc = readCodeOnly("lib/server/secReportDates.ts").replace(/^import[\s\S]*?from\s*"[^"]+";$/gm, "")
  .replace(/export (const|function|type)/g, "$1");
const RD = await lift(rdSrc + "\nexport { resultsPairing, parseAcceptanceEt };", "", "secReportDates");
const needSubs = [...new Set([...gridSyms, ...candPairs.map((c) => c.symbol), ...storeEvents.map((e) => e.symbol)])].sort();
const subsBy = new Map();
let subsFailed = 0, noCik = 0;
const t0 = Date.now();
for (const s of needSubs) {
  const cik = (manifestSet.has(s) && manifest.symbols[s]?.cik) || tick(s)?.cik;
  if (!cik) { noCik++; continue; }
  const subs = await fetchSec(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, "0")}.json`);
  if (!subs?.filings?.recent) { subsFailed++; subsBy.set(s, null); continue; }
  const rec = subs.filings.recent;
  const filings = [];
  for (let i = 0; i < (rec.accessionNumber?.length ?? 0); i++) {
    const on = RD.parseAcceptanceEt(rec.acceptanceDateTime?.[i])?.date ?? rec.filingDate?.[i];
    if (!on || on < addDays(FROM, -60) || on > addDays(TODAY, 1)) continue;
    filings.push({ form: rec.form[i], items: rec.items?.[i] ?? "", on });
  }
  const forms = new Set((rec.form ?? []).slice(0, 200));
  const events202 = RD.resultsPairing(subs, new Set()).events.filter((e) => e.basis === "8-K item 2.02").map((e) => e.announcedOn);
  subsBy.set(s, {
    name: subs.name ?? null,
    fpi: forms.has("20-F") || forms.has("40-F") || forms.has("6-K"),
    periodic: forms.has("10-Q") || forms.has("10-K"),
    filings,
    events202,
  });
}
console.log(`  live submissions: ${subsBy.size - subsFailed} read · ${subsFailed} failed · ${noCik} symbols with no CIK · ${((Date.now() - t0) / 1000).toFixed(0)}s`);

// ════════════════════════════════════════════════════════════════════════════
// A. CANDIDATES
// ════════════════════════════════════════════════════════════════════════════
// Greedy nearest-date pairing per symbol, each side used once.
const pairUp = (fmp, sec) => {
  const bySym = (xs) => xs.reduce((m, x) => m.set(x.symbol, [...(m.get(x.symbol) ?? []), x]), new Map());
  const F = bySym(fmp), S = bySym(sec);
  const matched = [], fOnly = [], sOnly = [];
  for (const [sym, fl] of F) {
    const sl = [...(S.get(sym) ?? [])];
    const cand = [];
    for (const f of fl) for (const s of sl) {
      const d = diffDays(s.date, f.date);
      if (Math.abs(d) <= MATCH_TOL) cand.push({ f, s, d });
    }
    cand.sort((a, b) => Math.abs(a.d) - Math.abs(b.d));
    const usedF = new Set(), usedS = new Set();
    for (const c of cand) {
      if (usedF.has(c.f) || usedS.has(c.s)) continue;
      usedF.add(c.f); usedS.add(c.s); matched.push(c);
    }
    for (const f of fl) if (!usedF.has(f)) fOnly.push(f);
    for (const s of sl) if (!usedS.has(s)) sOnly.push(s);
    S.delete(sym);
  }
  for (const sl of S.values()) sOnly.push(...sl);
  return { matched, fOnly, sOnly };
};
const bucket = (d) => (d === 0 ? "same day" : Math.abs(d) === 1 ? "±1 day" : Math.abs(d) <= 3 ? "2-3 days" : "4-10 days");
const agreement = (matched) => {
  const b = tally(matched.map((m) => bucket(m.d)));
  const signed = tally(matched.map((m) => m.d));
  return `${fmtTally(b)}\n    signed (SEC minus FMP, days): ${[...signed].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k > 0 ? "+" : ""}${k}:${v}`).join(" ")}`;
};

// The reason an FMP row has no SEC event, read off the filer's own submissions.
const fmpOnlyReason = (row, inUniverse) => {
  const t = tick(row.symbol);
  const cik = (inUniverse && manifest.symbols[row.symbol]?.cik) || t?.cik;
  if (!cik) return { cls: "no CIK", note: "" };
  const sub = subsBy.get(row.symbol);
  if (!sub) return { cls: "other: submissions unreadable", note: "" };
  const near202 = sub.events202.filter((d) => Math.abs(diffDays(d, row.date)) <= MATCH_TOL);
  if (near202.length) {
    const rec = store.get(row.symbol);
    return inUniverse
      ? rec
        ? { cls: "other: in universe, 2.02 on EDGAR, stored record lacks it", note: `2.02 ${near202.join("/")}; record read ${rec.at}; stored ${rec.all.slice(0, 2).map((e) => e.announcedOn).join("/")}` }
        : { cls: "other: in universe, 2.02 on EDGAR, NO stored record", note: `2.02 ${near202.join("/")}` }
      : { cls: "not in our universe (SEC has a 2.02)", note: `2.02 ${near202.join("/")}` };
  }
  const far202 = sub.events202.filter((d) => Math.abs(diffDays(d, row.date)) <= 45);
  if (far202.length) return { cls: `${inUniverse ? "" : "not in universe + "}2.02 filed but >${MATCH_TOL}d from FMP date`, note: `2.02 ${far202.join("/")}` };
  const near = (lo, hi) => sub.filings.filter((f) => { const d = diffDays(f.on, row.date); return d >= lo && d <= hi; });
  const sixK = near(-3, MATCH_TOL).filter((f) => f.form.startsWith("6-K"));
  if (sub.fpi && (sixK.length || !sub.periodic)) return { cls: `${inUniverse ? "" : "not in universe + "}FPI / 6-K`, note: sixK.length ? `6-K ${sixK.map((f) => f.on).join("/")}` : "20-F/40-F filer" };
  const other8k = near(-3, 3).filter((f) => f.form.startsWith("8-K"));
  if (other8k.length) return { cls: `${inUniverse ? "" : "not in universe + "}filed under a different item`, note: other8k.map((f) => `${f.form} ${f.on} [${f.items}]`).join("; ") };
  const periodic = near(-3, 3).filter((f) => /^10-[QK]/.test(f.form));
  if (periodic.length) return { cls: `${inUniverse ? "" : "not in universe + "}10-Q/10-K only, no 8-K 2.02`, note: periodic.map((f) => `${f.form} ${f.on}`).join("; ") };
  if (row.date >= addDays(TODAY, -1)) return { cls: `${inUniverse ? "" : "not in universe + "}not filed yet`, note: "" };
  return { cls: `${inUniverse ? "" : "not in universe + "}other: nothing on EDGAR near the FMP date`, note: "" };
};

// Why an SEC event has no FMP grid row, walked down the grid's own pipeline.
const secOnlyReason = (ev) => {
  const near = (dates) => [...(dates ?? [])].filter((d) => Math.abs(diffDays(d, ev.date)) <= MATCH_TOL);
  if (!candidates) return { cls: "not on grid rows (raw FMP months not in Redis — cannot split further)", note: "" };
  const raw = rawPairs.get(ev.symbol);
  if (!raw) return { cls: "FMP calendar never listed the symbol in the window", note: "" };
  if (!near(raw).length) return { cls: `FMP listed it, but >${MATCH_TOL}d away`, note: `FMP ${[...raw].sort().join("/")}` };
  if (dropped.noName.has(ev.symbol)) return { cls: "dropped: no stock-list name", note: "" };
  if (dropped.shape.has(ev.symbol)) return { cls: "dropped: symbol-shape filter", note: "" };
  const cand = candPairs.filter((c) => c.symbol === ev.symbol && Math.abs(diffDays(c.date, ev.date)) <= MATCH_TOL);
  if (!cand.length) return { cls: "collapsed to another date by the one-per-month rule", note: `candidate ${candPairs.filter((c) => c.symbol === ev.symbol).map((c) => c.date).join("/")}` };
  const st = dayState.find((x) => x.date === cand[0].date);
  if (!st?.items) return { cls: "candidate, but its date was never materialised", note: cand[0].date };
  if (!st.complete) return { cls: "candidate, date only partly populated", note: `${cand[0].date} (${st.items.length} rows)` };
  return { cls: "candidate on a complete date, NOT ADMITTED by the exchange test", note: cand[0].date };
};

const printA = (label, fmp, sec, inUniverse) => {
  const { matched, fOnly, sOnly } = pairUp(fmp, sec);
  console.log(`\n-- ${label} --`);
  console.log(`  FMP pairs ${fmp.length} · SEC events ${sec.length} · OVERLAP ${matched.length} · FMP-only ${fOnly.length} · SEC-only ${sOnly.length}`);
  console.log(`  date agreement on the overlap (n=${matched.length}): ${agreement(matched)}`);
  const far = matched.filter((m) => Math.abs(m.d) >= 2).map((m) => `${m.f.symbol} FMP ${m.f.date} SEC ${m.s.date}`);
  console.log(`  overlap pairs ≥2 days apart (${far.length}): ${ex(far, 40)}`);
  const fr = fOnly.map((r) => ({ r, ...fmpOnlyReason(r, inUniverse(r.symbol)) }));
  console.log(`  FMP-only by reason:`);
  for (const [cls, n] of [...tally(fr.map((x) => x.cls))].sort((a, b) => b[1] - a[1])) {
    const xs = fr.filter((x) => x.cls === cls).map((x) => `${x.r.symbol} ${x.r.date}${x.note ? ` (${x.note})` : ""}`);
    console.log(`    ${n}  ${cls}\n        e.g. ${ex(xs, 15)}`);
  }
  const sr = sOnly.map((e) => ({ e, ...secOnlyReason(e) }));
  console.log(`  SEC-only by reason:`);
  for (const [cls, n] of [...tally(sr.map((x) => x.cls))].sort((a, b) => b[1] - a[1])) {
    const xs = sr.filter((x) => x.cls === cls).map((x) => `${x.e.symbol} ${x.e.date} [${x.e.basis}]${x.note ? ` (${x.note})` : ""}`);
    console.log(`    ${n}  ${cls}\n        e.g. ${ex(xs, 15)}`);
  }
  return { matched, fOnly, sOnly };
};

console.log("\n== A. CANDIDATES ==");
const gridPairs = gridRows.map((r) => ({ symbol: r.symbol, date: r.date }));
// A1: our universe only — the like-for-like comparison, since the stored record
// exists only for manifest symbols.
printA("A1  grid rows vs STORED record, manifest universe only",
  gridPairs.filter((p) => manifestSet.has(p.symbol)), storeEvents, () => true);
// A2: the whole grid, SEC side = stored record ∪ live 8-K 2.02s for grid
// symbols outside the manifest. Answers "could SEC supply the whole grid".
const liveEvents = [];
for (const s of gridSyms) {
  if (manifestSet.has(s)) continue;
  for (const d of subsBy.get(s)?.events202 ?? []) if (inWindow(d)) liveEvents.push({ symbol: s, date: d, basis: "8-K item 2.02 (live submissions)" });
}
const a2 = printA("A2  ALL grid rows vs stored record ∪ live 8-K 2.02 for non-manifest grid symbols",
  gridPairs, [...storeEvents.filter((e) => true), ...liveEvents], (s) => manifestSet.has(s));
if (candidates) {
  printA("A3  pre-admission CANDIDATES (manifest universe) vs STORED record",
    candPairs.filter((p) => manifestSet.has(p.symbol)), storeEvents, () => true);
}
// Grid symbols the manifest does not carry, by what SEC says about them.
const outside = gridSyms.filter((s) => !manifestSet.has(s));
console.log(`\n  grid symbols outside the manifest: ${outside.length}/${gridSyms.length} · with a CIK ${outside.filter((s) => tick(s)).length} · of those, a live 8-K 2.02 in window ${outside.filter((s) => (subsBy.get(s)?.events202 ?? []).some(inWindow)).length}`);

// ════════════════════════════════════════════════════════════════════════════
// B. NAMES
// ════════════════════════════════════════════════════════════════════════════
console.log("\n== B. NAMES ==");
const fmpName = new Map(gridRows.map((r) => [r.symbol, r.company]));
const withFmp = gridSyms.filter((s) => typeof fmpName.get(s) === "string" && fmpName.get(s).trim());
const factMembers = gridSyms.filter((s) => manifestSet.has(s));
const facts = await mgetAll(factMembers.map((s) => `${K.FACTS}:${s}`), 10);
const entityName = new Map(factMembers.map((s, i) => [s, facts[i]?.entityName ?? null]));
console.log(`  grid symbols ${gridSyms.length} · FMP stock-list name ${withFmp.length} (${pct(withFmp.length, gridSyms.length)}) — 100% BY CONSTRUCTION: getMonthCandidates drops any row without one`);
const withTitle = gridSyms.filter((s) => tick(s)?.title);
console.log(`  SEC company_tickers_exchange title: ${withTitle.length} (${pct(withTitle.length, gridSyms.length)}) · missing ${gridSyms.length - withTitle.length}`);
console.log(`    missing: ${ex(gridSyms.filter((s) => !tick(s)?.title).map((s) => `${s} "${fmpName.get(s)}"`), 60)}`);
const withEntity = factMembers.filter((s) => entityName.get(s));
console.log(`  stored fact set entityName (manifest members only): ${withEntity.length}/${factMembers.length} manifest grid symbols (${pct(withEntity.length, gridSyms.length)} of the grid)`);
const withAnySec = gridSyms.filter((s) => tick(s)?.title || entityName.get(s) || subsBy.get(s)?.name);
console.log(`  ANY SEC name (title ∪ entityName ∪ submissions.name): ${withAnySec.length} (${pct(withAnySec.length, gridSyms.length)})`);

const SUFFIX = /\b(incorporated|inc|corporation|corp|company|co|limited|ltd|plc|holdings?|group|sa|s a|nv|n v|ag|se|lp|l p|llc|the|trust|bancorp|de|new|class [a-z]|ordinary shares|common stock|adr|ads)\b/g;
const norm = (s) => String(s ?? "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]/g, " ").replace(SUFFIX, " ").replace(/\s+/g, " ").trim();
const cmp = gridSyms.filter((s) => tick(s)?.title).map((s) => {
  const f = fmpName.get(s), t = tick(s).title;
  const kind = f === t ? "identical" : f.toLowerCase() === t.toLowerCase() ? "case only"
    : norm(f) === norm(t) ? "same after punctuation/suffix normalisation"
      : norm(f).split(" ")[0] === norm(t).split(" ")[0] ? "first word agrees, rest differs" : "DIFFERENT";
  return { s, f, t, kind };
});
console.log(`  FMP name vs SEC title, over ${cmp.length} symbols with both: ${fmtTally(tally(cmp.map((c) => c.kind)))}`);
for (const k of ["DIFFERENT", "first word agrees, rest differs"]) {
  const xs = cmp.filter((c) => c.kind === k).map((c) => `${c.s}: FMP "${c.f}" | SEC "${c.t}"`);
  console.log(`  ${k} (${xs.length}):`);
  for (const x of xs.slice(0, k === "DIFFERENT" ? 200 : 40)) console.log(`    ${x}`);
  if (xs.length > (k === "DIFFERENT" ? 200 : 40)) console.log(`    … (+${xs.length - (k === "DIFFERENT" ? 200 : 40)})`);
}
if (candidates) {
  const noNameUsListed = [...dropped.noName].filter((s) => ["Nasdaq", "NYSE", "CBOE"].includes(tick(s)?.exchange));
  console.log(`  FMP rows DROPPED for no stock-list name: ${dropped.noName.size} symbols; of those SEC lists ${[...dropped.noName].filter((s) => tick(s)).length} with a title, ${noNameUsListed.length} on Nasdaq/NYSE/CBOE`);
  console.log(`    e.g. ${ex(noNameUsListed.map((s) => `${s} "${tick(s).title}" ${tick(s).exchange}`), 30)}`);
}

// ════════════════════════════════════════════════════════════════════════════
// C. ADMISSION
// ════════════════════════════════════════════════════════════════════════════
console.log("\n== C. ADMISSION ==");
const poolNow = new Map();
const poolAsk = [...new Set([...gridSyms, ...candPairs.map((c) => c.symbol)])];
for (const c of chunk(poolAsk, 300)) {
  const raw = await redis.hmget(K.POOL, ...c);
  c.forEach((s, i) => {
    const row = Array.isArray(raw) ? raw[i] : raw?.[s];
    if (row && typeof row === "object" && typeof row.ts === "number") poolNow.set(s, row);
  });
}
const inPool = (s) => poolNow.get(s)?.price != null; // usOk requires a non-null price
const cov = tally(gridRows.map((r) => r.priceCoverage ?? "(field absent — blob predates it)"));
console.log(`  grid rows by how they were admitted (priceCoverage at populate time): ${fmtTally(cov)}`);
console.log(`    "covered" = pool hit => usOk; "outside-bar-universe" = no pool hit => admitted by FMP quote exchange in [${ALLOWED}]`);
const symCov = new Map();
for (const r of gridRows) symCov.set(r.symbol, r.priceCoverage === "covered" ? "usOk" : r.priceCoverage === "outside-bar-universe" ? "fmpExchange" : symCov.get(r.symbol) ?? "unknown");
const byUsOk = gridSyms.filter((s) => symCov.get(s) === "usOk");
const byFmp = gridSyms.filter((s) => symCov.get(s) === "fmpExchange");
console.log(`  grid SYMBOLS: admitted via usOk ${byUsOk.length} · via FMP exchange only ${byFmp.length} · unknown ${gridSyms.length - byUsOk.length - byFmp.length}`);
console.log(`  pool NOW holds ${gridSyms.filter(inPool).length}/${gridSyms.length} grid symbols with a price`);
console.log(`  a usOk-ONLY test (pool now) would admit ${gridSyms.filter(inPool).length} and DROP ${gridSyms.filter((s) => !inPool(s)).length} of today's grid symbols`);
const exOf = (s) => tick(s)?.exchange ?? (tick(s) ? "(blank)" : "(no SEC ticker)");
console.log(`    SEC exchange of the FMP-exchange-only symbols: ${fmtTally(tally(byFmp.map(exOf)))}`);
console.log(`    e.g. ${ex(byFmp.map((s) => `${s}[${exOf(s)}]`), 40)}`);
console.log(`    SEC exchange of the usOk symbols: ${fmtTally(tally(byUsOk.map(exOf)))}`);
const usOkNotSecListed = byUsOk.filter((s) => !["Nasdaq", "NYSE", "CBOE"].includes(tick(s)?.exchange));
console.log(`    usOk symbols SEC does NOT place on Nasdaq/NYSE/CBOE (${usOkNotSecListed.length}): ${ex(usOkNotSecListed.map((s) => `${s}[${exOf(s)}]`), 40)}`);
const nowInPoolButFmp = byFmp.filter(inPool);
console.log(`    admitted via FMP exchange then, but IN the pool now (${nowInPoolButFmp.length}): ${ex(nowInPoolButFmp, 30)}`);
const usOkLeft = byUsOk.filter((s) => !inPool(s));
console.log(`    admitted via usOk then, NOT in the pool now (${usOkLeft.length}): ${ex(usOkLeft, 30)}`);

if (candidates) {
  const gridKey = new Set(gridRows.map((r) => `${r.symbol}|${r.date}`));
  const completeDates = new Set(dayState.filter((x) => x.complete && x.items).map((x) => x.date));
  const onComplete = candPairs.filter((c) => completeDates.has(c.date));
  const rejected = onComplete.filter((c) => !gridKey.has(`${c.symbol}|${c.date}`));
  console.log(`  candidates on COMPLETE dates: ${onComplete.length} · admitted ${onComplete.length - rejected.length} · REJECTED by the exchange test ${rejected.length}`);
  console.log(`    SEC exchange of the rejected: ${fmtTally(tally(rejected.map((c) => exOf(c.symbol))))}`);
  const rejSecListed = rejected.filter((c) => ["Nasdaq", "NYSE", "CBOE"].includes(tick(c.symbol)?.exchange));
  console.log(`    rejected by FMP but SEC places on Nasdaq/NYSE/CBOE (${rejSecListed.length}): ${ex(rejSecListed.map((c) => `${c.symbol} ${c.date}[${exOf(c.symbol)}]`), 40)}`);
  const rejInPool = rejected.filter((c) => inPool(c.symbol));
  console.log(`    rejected but IN the pool now — usOk would admit (${rejInPool.length}): ${ex(rejInPool.map((c) => `${c.symbol} ${c.date}`), 40)}`);
  console.log(`    rejected, e.g.: ${ex(rejected.map((c) => `${c.symbol} "${c.company}"`), 30)}`);
} else {
  console.log("  REJECTED candidates: NOT MEASURABLE — the raw month rows or the name map are absent from Redis, so the pre-admission list cannot be rebuilt");
}
console.log("  FMP quote's exchange VALUE for any symbol: NOT MEASURABLE — it is held only in Next's per-instance fetch cache, never in Redis");
console.log("\ndone.");
