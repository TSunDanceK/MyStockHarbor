// PICKERS OFF FMP FUNDAMENTALS — SEC COVERAGE VS FMP, PER COLUMN, MEASURED FIRST.
//
// #553 COWORK #1 item 4: "Measure first: SEC coverage vs FMP per column across
// the universe, posted before the PR." This is that measurement. Nothing in the
// app changes because of it.
//
// ── THE FMP SIDE IS WHAT PRODUCTION ALREADY SHOWS ────────────────────────────
// No FMP key is in the relay, deliberately. The FMP value for each column is
// read from the three Redis records the picker pages merge, in the page's own
// order (app/components/PickerResultPage.tsx: fundamentals, then the price pool
// on top, then the stock-data row):
//   msh:pickers:fundamentals:v1:<SYM>   marketCap, peRatio, industry, sector
//   msh:price-pool:v1  (hash)           price, marketCap, pe  (pool wins)
//   msh:stockdata:v1:<SYM>              every valuation/dividend/financial field
//
// ── THE SEC SIDE IS THE SHIPPED CODE ─────────────────────────────────────────
// readFactSet (secFactStore.ts, with its hash gate), valuationInputs /
// marketCap / peRatio / valuationMultiples / twelveMonthsOf (secValuation.ts)
// and the revenueLineIncomplete guard those already apply. The price is the
// pool's price -- the one the page shows until Friday's split. The few columns
// secValuation does not compute (EV, P/FCF, FCF, dividends) are built from the
// same twelveMonthsOf period rule, and each says so in the output.
//
// ── THE PRESETS ──────────────────────────────────────────────────────────────
// Cowork's rule: "No preset page may go to 0 rows because of a column switch."
// So the six predicate pages are simulated from their own configs, FMP values
// vs SEC values, with the overlap.
//
// READ-ONLY. HKEYS/HMGET/MGET/GET only; nothing is written. The write- prefix on
// the relay task is the CREDENTIAL boundary, as for every census task.
//   relay task: write-pickers-sec-coverage
//   Redis cost: 1 HKEYS + 1 HMGET per 100 symbols + 2 MGET per 100 + 1 GET per
//   symbol (readFactSet) ≈ 750 commands for ~720 symbols, once.
import "./lib/register-ts-here.mjs";
import fs from "node:fs";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
const { readFactSet } = await import("../lib/server/secFactStore.ts");
const V = await import("../lib/server/secValuation.ts");
const { valueOf } = await import("../lib/server/secFactCodec.ts");

const TODAY = process.env.TODAY || new Date().toISOString().slice(0, 10);
const REGISTRANTS = JSON.parse(fs.readFileSync("data/sec/registrants.json", "utf8")).rows ?? {};
const STATIC_PROFILE = JSON.parse(fs.readFileSync("data/static-profile.json", "utf8"));
const SIC_SECTOR = JSON.parse(fs.readFileSync("data/sec/sic-sector.json", "utf8")).codes ?? {};

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const chunks = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));
let commands = 0;

// ─────────────────────────────────────────────── the universe and FMP's side
const poolSymbols = (await redis.hkeys("msh:price-pool:v1")).map(String).sort();
commands++;
console.log(`universe: ${poolSymbols.length} symbols in msh:price-pool:v1 (as of ${TODAY})`);

const pool = new Map();
const fund = new Map();
const sd = new Map();
for (const group of chunks(poolSymbols, 100)) {
  const [p, f, s] = await Promise.all([
    redis.hmget("msh:price-pool:v1", ...group),
    redis.mget(...group.map((x) => `msh:pickers:fundamentals:v1:${x}`)),
    redis.mget(...group.map((x) => `msh:stockdata:v1:${x}`)),
  ]);
  commands += 3;
  group.forEach((sym, i) => {
    const pr = Array.isArray(p) ? p[i] : p?.[sym];
    if (pr && typeof pr === "object") pool.set(sym, pr);
    if (f[i] && typeof f[i] === "object") fund.set(sym, f[i]);
    if (s[i] && typeof s[i] === "object") sd.set(sym, s[i]);
  });
}

// What the page shows today, per column, from the FMP-fed records.
function fmpRow(sym) {
  const p = pool.get(sym) ?? {};
  const f = fund.get(sym) ?? {};
  const d = sd.get(sym) ?? {};
  return {
    price: num(p.price),
    marketCap: num(p.marketCap) ?? num(f.marketCap),
    peRatio: num(p.pe) ?? num(f.peRatio),
    industry: f.industry ?? null,
    sector: f.sector ?? null,
    enterpriseValue: num(d.enterpriseValue),
    psRatio: num(d.psRatio),
    pbRatio: num(d.pbRatio),
    pfcfRatio: num(d.pfcfRatio),
    divPerShare: num(d.divPerShare),
    divYield: num(d.divYield),
    payoutRatio: num(d.payoutRatio),
    divGrowth: num(d.divGrowth),
    payoutFreq: d.payoutFreq ?? null,
    revenue: num(d.revenue),
    operatingIncome: num(d.operatingIncome),
    netIncome: num(d.netIncome),
    freeCashFlow: num(d.freeCashFlow),
    epsTtm: num(d.epsTtm),
    // Hidden columns: counted only, to say what hiding them removes.
    forwardEps: num(d.forwardEps),
    rating: d.rating ?? null,
    analystCount: num(d.analystCount),
    priceTarget: num(d.priceTarget),
  };
}

// ─────────────────────────────────────────────── SEC's side
const refusal = (why) => ({ refused: why });
const fig = (f) => (f == null ? refusal("no-price") : f.ok ? f.val : refusal(f.why));

function sumTwo(set, keys, offset) {
  // The trailing twelve months starting `offset` quarters back, four CONSECUTIVE
  // quarters only (secValuation's period rule), else null.
  const four = set.quarters.slice(offset, offset + 4);
  if (four.length < 4) return null;
  const out = {};
  for (const k of keys) {
    const parts = four.map((q) => valueOf(q, k));
    if (parts.some((v) => v === null)) return null;
    out[k] = parts.reduce((a, b) => a + b, 0);
  }
  return out;
}

function secRow(sym, set, price) {
  if (!set) {
    const r = refusal("no-fact-set");
    return Object.fromEntries(
      ["marketCap", "peRatio", "psRatio", "pbRatio", "enterpriseValue", "pfcfRatio", "revenue", "operatingIncome",
        "netIncome", "freeCashFlow", "epsTtm", "divPerShare", "divYield", "payoutRatio", "divGrowth"].map((k) => [k, r])
    );
  }
  const filer = { annualForm: REGISTRANTS[sym]?.annualForm ?? null };
  const inputs = V.valuationInputs(set, TODAY, filer);
  const m = V.multipleInputs(set);
  const mult = V.valuationMultiples(inputs, m, price);
  const cap = V.marketCap(inputs, price);
  const capVal = cap?.ok ? cap.val : null;

  const t = (keys) => V.twelveMonthsOf(set, keys);
  const rev = m.revenueIncomplete ? refusal("revenue-line-incomplete") : m.revenue ? m.revenue.vals.revenue : refusal("no-twelve-month-revenue");
  const oi = t(["operatingIncome"]);
  const ni = t(["netIncome"]);
  const cf = t(["operatingCashFlow", "capex"]);
  const fcf = cf ? cf.vals.operatingCashFlow - Math.abs(cf.vals.capex) : refusal("no-twelve-month-cash-flow");

  const bs = m.balanceSheet;
  const ev =
    capVal == null
      ? fig(cap)
      : !bs || bs.shortTermDebt === null || bs.longTermDebt === null || bs.cash === null
        ? refusal("enterprise-value-input-missing")
        : capVal + bs.shortTermDebt + bs.longTermDebt - bs.cash;

  const dps = t(["dividendsDeclaredPerShare"]);
  const tx = Array.isArray(set.tx) ? set.tx : [];
  const dpsVal = dps
    ? dps.vals.dividendsDeclaredPerShare
    : refusal(tx.includes("ifrs-full") && !tx.includes("us-gaap") ? "ifrs-no-per-share-tag" : "no-twelve-month-dividend");
  const eps = inputs.eps ? inputs.eps.val : refusal(inputs.refusals.find((r) => r.includes("eps")) ?? "no-twelve-month-eps");
  const epsForRatio = inputs.refusals.includes("ads-ratio-makes-eps-incomparable") ? refusal("ads-ratio-makes-eps-incomparable") : eps;

  const now = sumTwo(set, ["dividendsDeclaredPerShare"], 0);
  const prior = sumTwo(set, ["dividendsDeclaredPerShare"], 4);
  let growth;
  if (now && prior && prior.dividendsDeclaredPerShare > 0) {
    growth = ((now.dividendsDeclaredPerShare - prior.dividendsDeclaredPerShare) / prior.dividendsDeclaredPerShare) * 100;
  } else {
    const [y0, y1] = set.years;
    const a = valueOf(y0, "dividendsDeclaredPerShare");
    const b = valueOf(y1, "dividendsDeclaredPerShare");
    growth = a !== null && b !== null && b > 0 ? ((a - b) / b) * 100 : refusal("no-two-year-dividend");
  }

  return {
    marketCap: fig(cap),
    peRatio: fig(mult.pe),
    psRatio: fig(mult.ps),
    pbRatio: fig(mult.pb),
    enterpriseValue: ev,
    pfcfRatio: capVal == null ? fig(cap) : typeof fcf === "number" ? (fcf > 0 ? capVal / fcf : refusal("fcf-is-zero-or-negative")) : fcf,
    revenue: rev,
    operatingIncome: oi ? oi.vals.operatingIncome : refusal("no-twelve-month-operating-income"),
    netIncome: ni ? ni.vals.netIncome : refusal("no-twelve-month-net-income"),
    freeCashFlow: fcf,
    epsTtm: eps,
    divPerShare: dpsVal,
    divYield: typeof dpsVal === "number" && price ? (dpsVal / price) * 100 : typeof dpsVal === "number" ? refusal("no-price") : dpsVal,
    payoutRatio:
      typeof dpsVal !== "number" ? dpsVal : typeof epsForRatio !== "number" ? epsForRatio : epsForRatio <= 0 ? refusal("eps-is-zero-or-negative") : (dpsVal / epsForRatio) * 100,
    divGrowth: growth,
  };
}

// Sector/industry without FMP's live profile: the committed snapshot, then SIC.
function taxonomy(sym) {
  const snap = STATIC_PROFILE[sym];
  const sic = REGISTRANTS[sym]?.sic ?? null;
  return {
    sector: snap?.sector ?? (sic ? SIC_SECTOR[sic]?.sector ?? null : null),
    industry: snap?.industry ?? null,
    sectorFrom: snap?.sector ? "snapshot" : sic && SIC_SECTOR[sic]?.sector ? "sic" : null,
    semiconductorSic: sic === "3674",
  };
}

// ─────────────────────────────────────────────── read the fact sets
const rows = [];
let sets = 0;
for (const group of chunks(poolSymbols, 25)) {
  const got = await Promise.all(group.map((s) => readFactSet(s).catch(() => null)));
  commands += group.length;
  group.forEach((sym, i) => {
    if (got[i]) sets++;
    const fmp = fmpRow(sym);
    rows.push({ sym, fmp, sec: secRow(sym, got[i], fmp.price), tax: taxonomy(sym) });
  });
}
console.log(`fact sets readable: ${sets}/${poolSymbols.length}; pool price present: ${rows.filter((r) => r.fmp.price).length}`);
console.log(`stock-data rows: ${sd.size}; fundamentals rows: ${fund.size}\n`);

// ─────────────────────────────────────────────── per column
const COLS = [
  ["marketCap", "Market Cap", "price × SEC cover shares"],
  ["peRatio", "PE Ratio", "price ÷ TTM diluted EPS"],
  ["psRatio", "PS Ratio", "cap ÷ TTM revenue (guarded)"],
  ["pbRatio", "PB Ratio", "cap ÷ equity"],
  ["enterpriseValue", "Ent. Value", "cap + debt − cash"],
  ["pfcfRatio", "P/FCF", "cap ÷ (OCF − capex) TTM"],
  ["revenue", "Revenue", "TTM, guarded"],
  ["operatingIncome", "Op. Income", "TTM"],
  ["netIncome", "Net Income", "TTM"],
  ["freeCashFlow", "FCF", "OCF − capex TTM"],
  ["epsTtm", "EPS", "TTM diluted"],
  ["divPerShare", "Div ($)", "declared/share TTM"],
  ["divYield", "Div Yield", "DPS ÷ price"],
  ["payoutRatio", "Payout Ratio", "DPS ÷ EPS"],
  ["divGrowth", "Div Growth", "TTM vs prior TTM"],
];
const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1)}%` : "—");
const close = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(Math.abs(a), Math.abs(b));
const N = rows.length;

console.log("column        | FMP shows | SEC computes | both | agree ±5% | agree ±20% | FMP-only (SEC refusal: top 3)");
console.log("--------------|-----------|--------------|------|-----------|------------|------------------------------");
const worst = {};
for (const [key, label] of COLS) {
  let fmpHas = 0, secHas = 0, both = 0, a5 = 0, a20 = 0;
  const why = new Map();
  const diffs = [];
  for (const r of rows) {
    const f = r.fmp[key];
    const s = r.sec[key];
    const fOk = typeof f === "number";
    const sOk = typeof s === "number";
    if (fOk) fmpHas++;
    if (sOk) secHas++;
    if (fOk && sOk) {
      both++;
      if (close(f, s, 0.05)) a5++;
      if (close(f, s, 0.2)) a20++;
      else diffs.push([r.sym, f, s]);
    } else if (fOk && !sOk) {
      const w = s?.refused ?? "unknown";
      why.set(w, (why.get(w) ?? 0) + 1);
    }
  }
  const top = [...why].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([w, n]) => `${w} ${n}`).join(", ");
  console.log(
    `${label.padEnd(13)} | ${String(fmpHas).padStart(9)} | ${String(secHas).padStart(12)} | ${String(both).padStart(4)} | ${pct(a5, both).padStart(9)} | ${pct(a20, both).padStart(10)} | ${top}`
  );
  worst[label] = diffs
    .sort((x, y) => Math.abs(Math.log(Math.abs(y[1] / y[2]) || 1)) - Math.abs(Math.log(Math.abs(x[1] / x[2]) || 1)))
    .slice(0, 5);
}

// Taxonomy.
const secCount = (fn) => rows.filter(fn).length;
console.log(`\nSector:   FMP ${secCount((r) => r.fmp.sector)} · snapshot/SIC ${secCount((r) => r.tax.sector)} (SIC-only ${secCount((r) => r.tax.sectorFrom === "sic")}) · agree ${secCount((r) => r.fmp.sector && r.fmp.sector === r.tax.sector)}`);
console.log(`Industry: FMP ${secCount((r) => r.fmp.industry)} · snapshot ${secCount((r) => r.tax.industry)} · agree ${secCount((r) => r.fmp.industry && r.fmp.industry === r.tax.industry)}`);

// Hidden columns: what hiding them removes.
console.log(
  `\nAnalyst columns (to be HIDDEN) — rows FMP fills today: Forward PE ${secCount((r) => r.fmp.forwardEps != null)}, ` +
    `Rating ${secCount((r) => r.fmp.rating)}, Analysts ${secCount((r) => r.fmp.analystCount != null)}, Price Target ${secCount((r) => r.fmp.priceTarget != null)}`
);
console.log(`Payout Freq. — FMP fills ${secCount((r) => r.fmp.payoutFreq)} (no SEC equivalent computed here)`);

// ─────────────────────────────────────────────── presets
const PRESETS = [
  ["/low-pe-stocks", (v) => v.peRatio != null && v.peRatio <= 15],
  ["/high-dividend-yield-stocks", (v) => v.divYield != null && v.divYield >= 4],
  ["/dividend-growth-stocks", (v) => v.divYield != null && v.divYield >= 2 && v.divGrowth != null && v.divGrowth >= 5],
  ["/cash-rich-value-stocks", (v) => v.freeCashFlow != null && v.freeCashFlow >= 10e9 && v.peRatio != null && v.peRatio <= 20],
  ["/cheap-tech-stocks", (v) => v.sector === "Technology" && v.peRatio != null && v.peRatio <= 25],
  ["/semiconductor-stocks", (v) => v.industry === "Semiconductors"],
];
const secValues = (r) => {
  const n = (x) => (typeof x === "number" ? x : null);
  return {
    peRatio: n(r.sec.peRatio), divYield: n(r.sec.divYield), divGrowth: n(r.sec.divGrowth),
    freeCashFlow: n(r.sec.freeCashFlow), sector: r.tax.sector, industry: r.tax.industry,
  };
};
console.log("\npreset                        | rows on FMP | rows on SEC | in both | FMP-only | SEC-only");
console.log("------------------------------|-------------|-------------|---------|----------|---------");
for (const [href, pass] of PRESETS) {
  const f = new Set(rows.filter((r) => pass(r.fmp)).map((r) => r.sym));
  const s = new Set(rows.filter((r) => pass(secValues(r))).map((r) => r.sym));
  const inBoth = [...f].filter((x) => s.has(x)).length;
  console.log(
    `${href.padEnd(29)} | ${String(f.size).padStart(11)} | ${String(s.size).padStart(11)} | ${String(inBoth).padStart(7)} | ${String(f.size - inBoth).padStart(8)} | ${String(s.size - inBoth).padStart(8)}`
  );
  const lost = [...f].filter((x) => !s.has(x)).slice(0, 12);
  if (lost.length) console.log(`    FMP-only e.g. ${lost.join(" ")}`);
}
console.log(`\nsemiconductor SIC 3674 in universe: ${secCount((r) => r.tax.semiconductorSic)}`);

console.log("\nlargest FMP/SEC disagreements (beyond ±20%), per column: symbol FMP SEC");
for (const [label, list] of Object.entries(worst)) {
  if (!list.length) continue;
  const fmt = (v) => (Math.abs(v) >= 1e6 ? `${(v / 1e9).toFixed(2)}B` : v.toFixed(2));
  console.log(`  ${label}: ${list.map(([s, f, v]) => `${s} ${fmt(f)}/${fmt(v)}`).join(" · ")}`);
}
console.log(`\nRedis commands used: ~${commands} (read-only)`);
