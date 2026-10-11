// WHY OP. INCOME AND FCF READ "–" FOR OXY / PSX, AND WHAT FMC'S DIV GROWTH IS
// COMPUTED FROM (#553 COWORK #199 items 2 and 4). READ-ONLY, ENFORCED (GET,
// HMGET), plus each filer's public companyfacts from SEC (our User-Agent).
//
// For each symbol: the stored picker row's operatingIncome / freeCashFlow;
// A's fact set: which of the newest 8 quarters and 2 years carry
// operatingIncome, operatingCashFlow and capex (and how: F filed, D
// differenced, C computed); twelveMonthsOf's answer; and in companyfacts,
// which us-gaap concepts the filer tags that our chains read or might.
// FMC: the eight quarters' DPS (filed per-share dividends) and the two
// four-quarter totals behind Div Growth.
//
// PUBLIC LOG: symbols, concept names, period labels, codes; DPS (filed). No price.
//
//   node scripts/oi-fcf-trace.mjs   (relay: write-oi-fcf-trace)
import { register } from "node:module";
register("./lib/next-cache-stub-hooks.mjs", import.meta.url);
register("./lib/ts-resolve-app.mjs", import.meta.url);

if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) { console.error("FATAL: needs the Upstash credentials."); process.exit(2); }
const READ_VERBS = new Set(["GET", "HMGET"]);
const UPSTASH = process.env.UPSTASH_REDIS_REST_URL.replace(/\/$/, "");
let commands = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (url.startsWith(UPSTASH)) {
    let body = init?.body;
    try { body = typeof body === "string" ? JSON.parse(body) : body; } catch { body = null; }
    const cmds = Array.isArray(body) && Array.isArray(body[0]) ? body : Array.isArray(body) ? [body] : [];
    if (!cmds.length) throw new Error("read-only: refused a request with no readable command");
    for (const c of cmds) if (!READ_VERBS.has(String(c?.[0] ?? "").toUpperCase())) throw new Error(`read-only: refused ${c?.[0]}`);
    commands += cmds.length;
  }
  return realFetch(input, init);
};
const UA = process.env.SEC_USER_AGENT || "MyStockHarbor/1.0 (sonnybrindle@mystockharbor.com; oi fcf trace)";
const redis = (await import("@upstash/redis")).Redis.fromEnv();
const { readFactSet } = await import("../lib/server/secFactStore.ts");
const { cell } = await import("../lib/server/secFactCodec.ts");
const { twelveMonthsOf } = await import("../lib/server/secValuation.ts");
const { dividendRead, quarterlyDps } = await import("../lib/server/pickersSecFundamentals.ts");
const parse = (v) => (typeof v === "string" ? JSON.parse(v) : v);
const label = (p) => `${p.fp ?? "?"} FY${p.fy ?? "?"}`;
const code = (p, k) => { const c = cell(p, k); return c.val === null ? "–" : (c.derived ?? "F")[0].toUpperCase(); };

const NAMED = (process.env.NAMED || "OXY PSX NVDA").split(/\s+/);
const rows = await redis.hmget("msh:pickers:sec-fundamentals:v1", ...NAMED);
const WATCH = /^(OperatingIncomeLoss|CostsAndExpenses|OperatingExpenses|NetCashProvidedByUsedInOperatingActivities.*|PaymentsToAcquire.*|CapitalExpenditure.*|PaymentsForCapitalImprovements|PaymentsToDevelop.*)$/;
for (const s of NAMED) {
  const r = parse(rows?.[s] ?? null);
  console.log(`\n== ${s} — picker row: operatingIncome ${r ? (r.operatingIncome === null ? "null" : "set") : "no row"} · freeCashFlow ${r ? (r.freeCashFlow === null ? "null" : "set") : "-"} · refusals [${(r?.inputs?.refusals ?? []).join(", ")}]`);
  const set = await readFactSet(s);
  if (!set) { console.log("  no fact set"); continue; }
  for (const k of ["operatingIncome", "operatingCashFlow", "capex"]) {
    const q = set.quarters.slice(0, 8).map((p) => `${label(p)}:${code(p, k)}`).join(" ");
    const y = set.years.slice(0, 2).map((p) => `${label(p)}:${code(p, k)}`).join(" ");
    console.log(`  ${k.padEnd(17)} quarters ${q} | years ${y}`);
  }
  const oi = twelveMonthsOf(set, ["operatingIncome"]);
  const cf = twelveMonthsOf(set, ["operatingCashFlow", "capex"]);
  console.log(`  twelveMonthsOf operatingIncome: ${oi ? `${oi.basis} to ${oi.periodEnd}` : "null"} · operatingCashFlow+capex: ${cf ? `${cf.basis} to ${cf.periodEnd}` : "null"}`);
  if (!set.cik) continue;
  try {
    const res = await realFetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(set.cik).padStart(10, "0")}.json`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) { console.log(`  companyfacts HTTP ${res.status}`); continue; }
    const cfj = await res.json();
    const gaap = cfj?.facts?.["us-gaap"] ?? {};
    const found = Object.keys(gaap).filter((c) => WATCH.test(c)).map((c) => {
      const units = Object.values(gaap[c].units ?? {}).flat();
      const latest = units.filter((u) => u.form === "10-K" || u.form === "10-Q").sort((a, b) => String(b.end).localeCompare(String(a.end)))[0];
      return `${c}${latest ? ` (latest ${latest.form} ${latest.fp ?? ""} FY${latest.fy ?? "?"}, end ${latest.end})` : " (no 10-K/10-Q)"}`;
    });
    console.log(`  companyfacts tags: ${found.length ? found.join("; ") : "none of the watched concepts"}`);
  } catch (err) {
    console.log(`  companyfacts error ${String(err?.message ?? err).slice(0, 60)}`);
  }
}

// FMC: what Div Growth is computed from.
const fmc = await readFactSet("FMC");
if (fmc) {
  const dps = quarterlyDps(fmc);
  console.log(`\n== FMC Div Growth inputs (newest first): ${fmc.quarters.slice(0, 8).map((p, i) => `${label(p)} ${dps[i] === null ? "–" : `$${dps[i]}`}${code(p, "dividendsDeclaredPerShare") === "–" && dps[i] !== null ? " (Q4 derived)" : ""}`).join(" · ")}`);
  const read = dividendRead(fmc);
  console.log(`  dividendRead: four ${read.four ? `$${read.four.regular.toFixed(4)} regular to ${read.four.periodEnd}` : "null"} · cut ${read.cut ? `annualised $${read.cut.annualised}, ttm $${read.cut.ttm}` : "none"} · growth ${read.growth === null ? "null" : `${read.growth.toFixed(2)}%`}`);
}
console.log(`\nRedis commands ${commands} (read-only: GET, HMGET)`);
