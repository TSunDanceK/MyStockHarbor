// IS FRED'S DEXTAUS CURRENT, WHICH WAY DOES IT POINT, AND WHAT HAS CHT BEEN
// CONVERTED WITH? (#535 COWORK #22 §0, #552 queue item 5)
//
// TSM's FY2025 20-F instance is TWD only, and TWD is not in the FX module's
// FRED map, so the only route a TWD set has today is the ECB fallback's cross
// (USD per EUR ÷ TWD per EUR). COWORK #22 calls CHT's rate a "stale ECB
// cross". Before DEXTAUS is added, this measures, rather than assumes:
//
//   1. DEXTAUS's range, its last observation, and its "." placeholders.
//   2. Its DIRECTION, from the value: TWD per USD sits near 30, USD per TWD near
//      0.03. The FX module stores USD per unit, so the wrong one is a 900x
//      error, not a rounding one.
//   3. ECB's TWD leg: whether it exists at all, and its last date. If it stops
//      years ago, the cross is not a fallback; it is a gap.
//   4. Where both exist on the same day, how far apart they are.
//
// Read-only and uncredentialled: it touches no store. It prints public
// reference rates only, never a price.
const UA = process.env.SEC_USER_AGENT || "MyStockHarbor fx probe";
const from = "2019-01-01";
const to = new Date().toISOString().slice(0, 10);

const get = async (url, accept = "*/*") => {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: accept }, signal: AbortSignal.timeout(30_000) });
    return { ok: res.ok, status: res.status, ct: res.headers.get("content-type") ?? "", body: await res.text() };
  } catch (e) {
    return { ok: false, status: 0, err: String(e?.message ?? e) };
  }
};
const isHtml = (b) => /^\s*<!DOCTYPE|^\s*<html/i.test(b ?? "");

// ── 1 + 2: FRED ───────────────────────────────────────────────────────────
console.log("=".repeat(74));
console.log(`FRED DEXTAUS, ${from} .. ${to}`);
console.log("=".repeat(74));
const fredUrl = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=DEXTAUS&cosd=${from}&coed=${to}`;
const f = await get(fredUrl);
const fred = new Map();
console.log(`status ${f.status} ct=${f.ct}${f.err ? ` err=${f.err}` : ""}`);
if (f.ok && !isHtml(f.body)) {
  const lines = f.body.trim().split("\n");
  console.log(`header: ${lines[0]}`);
  let dots = 0;
  for (const l of lines.slice(1)) {
    const [d, v] = l.split(",").map((s) => (s ?? "").trim());
    if (v === ".") { dots++; continue; }
    const n = Number(v);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(n) && n > 0) fred.set(d, n);
  }
  const dates = [...fred.keys()].sort();
  console.log(`1. ${fred.size} numeric rows, ${dots} "." placeholders; first ${dates[0]} = ${fred.get(dates[0])}, last ${dates.at(-1)} = ${fred.get(dates.at(-1))}`);
  const lastDays = Math.round((Date.parse(to) - Date.parse(dates.at(-1))) / 86_400_000);
  console.log(`   last observation is ${lastDays} day(s) before ${to}`);
  console.log(`   last 5: ${dates.slice(-5).map((d) => `${d}=${fred.get(d)}`).join(" ")}`);
  const sample = fred.get(dates.at(-1));
  console.log(`2. DIRECTION: ${sample} -> ${sample > 1 ? "TWD PER USD (divide: 1 TWD = $" + (1 / sample).toFixed(5) + ")" : "USD PER TWD (multiply)"}`);
  // The year-end and full-year averages TSM's FY2025 conversion would use.
  for (const y of ["2024", "2025"]) {
    const inYear = dates.filter((d) => d.startsWith(y));
    if (!inYear.length) { console.log(`   FY${y}: no rows`); continue; }
    const mean = inYear.reduce((a, d) => a + fred.get(d), 0) / inYear.length;
    console.log(`   FY${y}: ${inYear.length} rows, mean ${mean.toFixed(4)} TWD/USD, last ${inYear.at(-1)} = ${fred.get(inYear.at(-1))}`);
  }
} else {
  console.log(`NOT DATA. head: ${(f.body ?? "").slice(0, 200).replace(/\s+/g, " ")}`);
}

// ── 3: ECB's TWD leg, and the USD leg the cross needs ─────────────────────
const ecb = async (ccy) => {
  const url = `https://data-api.ecb.europa.eu/service/data/EXR/D.${ccy}.EUR.SP00.A?startPeriod=${from}&endPeriod=${to}&format=csvdata`;
  const r = await get(url, "text/csv");
  const out = new Map();
  if (!r.ok || isHtml(r.body)) return { status: r.status, err: r.err, out };
  const lines = r.body.trim().split("\n");
  const h = (lines[0] ?? "").split(",");
  const t = h.indexOf("TIME_PERIOD"), v = h.indexOf("OBS_VALUE");
  if (t < 0 || v < 0) return { status: r.status, err: "no TIME_PERIOD/OBS_VALUE", out };
  for (const l of lines.slice(1)) {
    const c = l.split(",");
    const n = Number((c[v] ?? "").trim());
    if (Number.isFinite(n) && n > 0) out.set((c[t] ?? "").trim(), n);
  }
  return { status: r.status, out };
};
console.log("\n" + "=".repeat(74));
console.log("ECB EXR, TWD per EUR and USD per EUR");
console.log("=".repeat(74));
const et = await ecb("TWD");
const eu = await ecb("USD");
const td = [...et.out.keys()].sort();
console.log(`3. TWD leg: status ${et.status}${et.err ? ` err=${et.err}` : ""}, ${et.out.size} rows${td.length ? `, ${td[0]} .. ${td.at(-1)}` : ""}`);
console.log(`   USD leg: status ${eu.status}${eu.err ? ` err=${eu.err}` : ""}, ${eu.out.size} rows`);

// ── 4: the same day, both routes, as TWD per USD ──────────────────────────
const both = td.filter((d) => eu.out.has(d) && fred.has(d));
console.log(`4. days with DEXTAUS and a full ECB cross: ${both.length}`);
if (both.length) {
  const gaps = both.map((d) => {
    const cross = et.out.get(d) / eu.out.get(d); // TWD per USD
    return { d, fred: fred.get(d), cross, pct: ((cross - fred.get(d)) / fred.get(d)) * 100 };
  });
  const abs = gaps.map((g) => Math.abs(g.pct)).sort((a, b) => a - b);
  console.log(`   |cross - DEXTAUS| %: median ${abs[Math.floor(abs.length / 2)].toFixed(3)}, p95 ${abs[Math.floor(abs.length * 0.95)].toFixed(3)}, max ${abs.at(-1).toFixed(3)}`);
  for (const g of gaps.slice(-3)) console.log(`   ${g.d}: DEXTAUS ${g.fred}  ECB cross ${g.cross.toFixed(4)}  (${g.pct.toFixed(3)}%)`);
}

// ── 5: WHICH CURRENCIES TSM'S AND CHT'S companyfacts CARRY, BY YEAR ───────
// The lock only matters if companyfacts has TWD rows beside the USD
// convenience ones. If it does, a TWD rate lets the whole set read in the
// filer's own currency; if it doesn't, FY2025 would be the only TWD year.
// Counts only, per currency and period end: SEC values, never a price.
console.log("\n" + "=".repeat(74));
console.log("5. companyfacts money units by period end (TSM, CHT)");
console.log("=".repeat(74));
const tick = await get("https://www.sec.gov/files/company_tickers.json", "application/json");
let cikOf = () => null;
try {
  const rows = Object.values(JSON.parse(tick.body ?? "{}"));
  const m = new Map(rows.map((r) => [String(r.ticker).toUpperCase(), String(r.cik_str).padStart(10, "0")]));
  cikOf = (s) => m.get(s) ?? null;
} catch { console.log(`ticker file unreadable (status ${tick.status})`); }
for (const sym of ["TSM", "CHT"]) {
  const cik = cikOf(sym);
  if (!cik) { console.log(`${sym}: no CIK`); continue; }
  const r = await get(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, "application/json");
  if (!r.ok) { console.log(`${sym}: companyfacts HTTP ${r.status}`); continue; }
  const facts = JSON.parse(r.body).facts ?? {};
  // currency -> annual period end -> set of tags
  const byCcy = new Map();
  for (const [ns, tags] of Object.entries(facts)) {
    for (const [tag, def] of Object.entries(tags ?? {})) {
      for (const [unit, list] of Object.entries(def?.units ?? {})) {
        const ccy = unit.split("/")[0];
        if (!/^[A-Z]{3}$/.test(ccy)) continue;
        for (const row of list ?? []) {
          // Annual duration rows only: a year's income-statement lines.
          if (!row.start || !row.end) continue;
          const days = (Date.parse(row.end) - Date.parse(row.start)) / 86_400_000;
          if (days < 350 || days > 380) continue;
          const y = byCcy.get(ccy) ?? new Map();
          byCcy.set(ccy, y);
          const s = y.get(row.end) ?? new Set();
          y.set(row.end, s);
          s.add(`${ns}:${tag}`);
        }
      }
    }
  }
  console.log(`\n${sym} (CIK ${cik})`);
  for (const [ccy, years] of [...byCcy].sort()) {
    const ends = [...years.keys()].sort().slice(-7);
    console.log(`  ${ccy}: ${ends.map((e) => `${e}:${years.get(e).size}`).join("  ")}`);
  }
  // The revenue and EPS rows themselves for the newest years, both currencies:
  // TSM's FY2024 card reads $88.27B / $1.36, so this shows where that came from.
  for (const tag of ["Revenue", "Revenues", "BasicEarningsLossPerShare", "EarningsPerShareBasic"]) {
    for (const ns of ["ifrs-full", "us-gaap"]) {
      const units = facts[ns]?.[tag]?.units;
      if (!units) continue;
      for (const [unit, list] of Object.entries(units)) {
        const annual = (list ?? []).filter((x) => x.start && x.end && (Date.parse(x.end) - Date.parse(x.start)) / 86_400_000 > 350);
        const newest = [...new Map(annual.map((x) => [x.end, x])).values()].sort((a, b) => (a.end < b.end ? -1 : 1)).slice(-3);
        console.log(`  ${ns}:${tag} [${unit}] ${newest.map((x) => `${x.end}=${x.val} (${x.form} ${x.filed})`).join("  ")}`);
      }
    }
  }
}
