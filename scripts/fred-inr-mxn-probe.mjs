// ARE FRED'S DEXINUS AND DEXMXUS CURRENT, WHICH WAY DO THEY POINT, AND DO THEY
// AGREE WITH THE ECB CROSS? (#552 COWORK #132 (c))
//
// The same four questions twd-rate-probe asked of DEXTAUS before it became a
// primary. INR and MXN had ECB only, and ECB timed out on both in the 3 Oct
// 20:22 UTC sec-facts run, which blanked those filers' sets.
//
//   1. Each series' range, last observation and "." placeholders.
//   2. DIRECTION, from the value: INR per USD sits near 80+, MXN per USD near
//      17+. The FX module stores USD per unit, so the wrong one is a huge error.
//   3. ECB's leg for the currency, and its last date.
//   4. Where both exist on the same day, how far apart they are.
//
// Read-only and uncredentialled: it touches no store. Public reference rates only.
const UA = process.env.SEC_USER_AGENT || "MyStockHarbor/1.0 (fx probe)";
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

const eu = await ecb("USD");
console.log(`ECB USD leg: status ${eu.status}${eu.err ? ` err=${eu.err}` : ""}, ${eu.out.size} rows`);

for (const [ccy, id] of [["INR", "DEXINUS"], ["MXN", "DEXMXUS"]]) {
  console.log("\n" + "=".repeat(74));
  console.log(`${ccy}: FRED ${id}, ${from} .. ${to}`);
  console.log("=".repeat(74));
  const f = await get(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${from}&coed=${to}`);
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
    console.log(`   last observation is ${Math.round((Date.parse(to) - Date.parse(dates.at(-1))) / 86_400_000)} day(s) before ${to}`);
    const sample = fred.get(dates.at(-1));
    console.log(`2. DIRECTION: ${sample} -> ${sample > 1 ? `${ccy} PER USD (divide: 1 ${ccy} = $${(1 / sample).toFixed(5)})` : `USD PER ${ccy} (multiply)`}`);
  } else {
    console.log(`NOT DATA. head: ${(f.body ?? "").slice(0, 200).replace(/\s+/g, " ")}`);
  }
  const leg = await ecb(ccy);
  const ld = [...leg.out.keys()].sort();
  console.log(`3. ECB ${ccy} leg: status ${leg.status}${leg.err ? ` err=${leg.err}` : ""}, ${leg.out.size} rows${ld.length ? `, ${ld[0]} .. ${ld.at(-1)}` : ""}`);
  const both = ld.filter((d) => eu.out.has(d) && fred.has(d));
  console.log(`4. days with ${id} and a full ECB cross: ${both.length}`);
  if (both.length) {
    const gaps = both.map((d) => {
      const cross = leg.out.get(d) / eu.out.get(d); // CCY per USD
      return { d, fred: fred.get(d), cross, pct: ((cross - fred.get(d)) / fred.get(d)) * 100 };
    });
    const abs = gaps.map((g) => Math.abs(g.pct)).sort((a, b) => a - b);
    console.log(`   |cross - ${id}| %: median ${abs[Math.floor(abs.length / 2)].toFixed(3)}, p95 ${abs[Math.floor(abs.length * 0.95)].toFixed(3)}, max ${abs.at(-1).toFixed(3)}`);
    for (const g of gaps.slice(-3)) console.log(`   ${g.d}: ${id} ${g.fred}  ECB cross ${g.cross.toFixed(4)}  (${g.pct.toFixed(3)}%)`);
  }
}
