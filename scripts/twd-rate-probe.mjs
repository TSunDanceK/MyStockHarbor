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
