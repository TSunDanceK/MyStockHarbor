// THE CONTENT CANDIDATES (#563 COWORK #182/#183): which stocks new bottleneck
// maps and insight posts may be picked from. The owner's rule: in the price
// universe AND with SEC data on file, so every panel on the page fills.
//
// TWO MODES, because the census needs Redis and the sandbox has none:
//
//   1. On the relay runner (relay task write-content-candidates; READ-ONLY
//      despite the prefix, which only routes it to the job holding the Upstash
//      credentials). One row per pool symbol is printed as a `CCROW {json}` log
//      line, plus a `CCMETA {json}` line.
//        Redis: 1 HGETALL (price pool) + 1 GET (Pickers universe) + 1 HMGET
//        (SEC picker rows) + 1-2 GET per symbol (its stored fact set). No
//        writes (the SEC rows are read directly, not through the metered
//        reader), no SEC requests, no FMP.
//
//   2. Locally: `node scripts/content-candidates.mjs --from-log <task.log>`
//      rebuilds data/content-candidates.json from those lines, recomputing
//      hasBottleneck and latestInsightDate from content/ (the schedules do the
//      same), then prints the two top-40 tables and the thin pages.
//
// THE COLUMNS. inPool: the pool row has a live close. hasSecFacts: a stored
// fact set that A's buildSecEarningsView builds without error (imported, not
// copied). thinFilings: most of the latest quarter's growth/margin figures are
// n/m under A's rule (#552 COWORK #212: the view's own markers). marketCap:
// price x SEC cover-page shares (secValuation.marketCap, the Pickers' figure),
// or null when SEC refuses it. sector: the committed SIC profile (sectorOf).
//
// REFRESH: monthly, or when the universe changes. Dispatch the relay with
// task=write-content-candidates, save the run's task.log, run mode 2, commit.
import fs from "node:fs";
import path from "node:path";

const OUT = "data/content-candidates.json";
const fromLog = process.argv.indexOf("--from-log");

/** The content flags, from the committed content/ tree. */
function contentFlags() {
  const bn = new Set(fs.readdirSync("content/bottlenecks").filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, "").toUpperCase()));
  const latest = new Map();
  for (const f of fs.readdirSync("content/insights").filter((f) => f.endsWith(".md"))) {
    const src = fs.readFileSync(path.join("content/insights", f), "utf8");
    const fm = src.split(/^---\s*$/m)[1] ?? "";
    const sym = /^symbol:\s*["']?([A-Za-z0-9.\-]+)/m.exec(fm)?.[1]?.toUpperCase();
    const date = /^date:\s*["']?(\d{4}-\d{2}-\d{2})/m.exec(fm)?.[1];
    if (sym && date && (!latest.has(sym) || latest.get(sym) < date)) latest.set(sym, date);
  }
  return { bn, latest };
}

if (fromLog < 0) {
  // ── MODE 1: THE RUNNER ────────────────────────────────────────────────────
  await import("./lib/register-ts-here.mjs");
  const { Redis } = await import("@upstash/redis");
  const V = await import("../lib/server/secEarningsView.ts");
  const VAL = await import("../lib/server/secValuation.ts");
  const STORE = await import("../lib/server/secFactStore.ts");
  const { pickersSecKey } = await import("../lib/server/pickersSecFundamentals.ts");
  const { PRICE_POOL_KEY } = await import("../lib/server/pricePool.ts");
  const { PICKERS_SYMBOLS_KEY } = await import("../lib/server/pickersBuilder.ts");
  const { sectorOf } = await import("../lib/server/sectorOf.ts");
  const { snapshotCompanyName } = await import("../lib/server/companyNameSnapshot.ts");
  const { normaliseCompanyName } = await import("../lib/server/news/companyName.ts");
  const redis = Redis.fromEnv();
  let commands = 0;

  const poolRaw = (await redis.hgetall(PRICE_POOL_KEY)) ?? {}; commands++;
  const uniRaw = await redis.get(PICKERS_SYMBOLS_KEY); commands++;
  const uniList = Array.isArray(uniRaw) ? uniRaw : Array.isArray(uniRaw?.symbols) ? uniRaw.symbols : [];
  const universe = new Set(uniList.map((x) => String(typeof x === "string" ? x : x?.symbol ?? "").toUpperCase()).filter(Boolean));
  const pool = new Map();
  for (const [k, v] of Object.entries(poolRaw)) {
    let r = v;
    if (typeof r === "string") try { r = JSON.parse(r); } catch { r = null; }
    if (r && typeof r === "object") pool.set(k.toUpperCase(), r);
  }
  const symbols = [...new Set([...pool.keys(), ...universe])].sort();
  const secRaw = symbols.length ? await redis.hmget(pickersSecKey({}), ...symbols) : []; commands++;
  const secRow = new Map(symbols.map((s, i) => [s, Array.isArray(secRaw) ? secRaw[i] : secRaw?.[s] ?? null]));

  let withFacts = 0;
  for (const symbol of symbols) {
    const p = pool.get(symbol);
    const price = typeof p?.price === "number" && p.price > 0 ? p.price : null;
    let set = null, view = null;
    try { set = await STORE.readFactSet(symbol); } catch { set = null; }
    commands += symbol.includes(".") || symbol.includes("-") ? 2 : 1;
    if (set) { try { view = V.buildSecEarningsView(set); } catch { view = null; } }
    if (view) withFacts++;
    // A's n/m markers on the latest quarter: growth plus the five margin figures.
    let nmCount = 0, figures = 0;
    if (view) {
      const m = view.margins.at(-1);
      const g = view.snapshot.revenueYoY;
      if (typeof g === "number") { figures++; if (view.snapshot.revenueYoYNotMeaningful) nmCount++; }
      for (const k of ["gross", "operating", "net"]) if (typeof m?.[k] === "number") { figures++; if (m.notMeaningful?.[k]) nmCount++; }
      // A change counts only where its margin is a figure (no gross line, no gross change).
      for (const [k, of] of [["grossChange", "gross"], ["operatingChange", "operating"]]) if (typeof m?.[of] === "number") { figures++; if (m.notMeaningful?.[k]) nmCount++; }
    }
    const row = secRow.get(symbol);
    let cap = null;
    const r = typeof row === "string" ? (() => { try { return JSON.parse(row); } catch { return null; } })() : row;
    if (r?.inputs && price !== null) {
      const fig = VAL.marketCap({ shares: r.inputs.shares, eps: null, refusals: r.inputs.refusals }, price);
      if (fig?.ok && typeof fig.val === "number") cap = Math.round(fig.val);
    }
    console.log(`CCROW ${JSON.stringify({
      symbol,
      name: normaliseCompanyName(snapshotCompanyName(symbol)) || set?.entityName || symbol,
      sector: sectorOf(symbol)?.name ?? null,
      marketCap: cap,
      inPool: price !== null,
      inUniverse: universe.has(symbol),
      hasSecFacts: !!view,
      nmCount, figures,
    })}`);
  }
  console.log(`CCMETA ${JSON.stringify({ generatedAt: new Date().toISOString(), symbols: symbols.length, pool: pool.size, universe: universe.size, withFacts, commands })}`);
  console.log(`Redis commands: ${commands} (read-only: HGETALL, GET, HMGET)`);
} else {
  // ── MODE 2: LOCAL, FROM THE RUN'S LOG ─────────────────────────────────────
  const log = fs.readFileSync(process.argv[fromLog + 1], "utf8");
  const rows = [...log.matchAll(/CCROW (\{.*\})\s*$/gm)].map((m) => JSON.parse(m[1]));
  const meta = JSON.parse(/CCMETA (\{.*\})\s*$/m.exec(log)?.[1] ?? "null");
  if (!rows.length || !meta) { console.error("no CCROW/CCMETA lines in the log"); process.exit(1); }
  const { bn, latest } = contentFlags();
  const symbols = rows.map((r) => ({
    symbol: r.symbol,
    name: r.name,
    sector: r.sector,
    marketCap: typeof r.marketCap === "number" ? r.marketCap : null,
    inPool: r.inPool === true,
    hasSecFacts: r.hasSecFacts === true,
    // Most of the latest quarter's growth/margin figures n/m (A's rule).
    thinFilings: r.figures > 0 && r.nmCount * 2 > r.figures,
    hasBottleneck: bn.has(r.symbol),
    latestInsightDate: latest.get(r.symbol) ?? null,
  })).sort((a, b) => (b.marketCap ?? -1) - (a.marketCap ?? -1) || a.symbol.localeCompare(b.symbol));
  fs.writeFileSync(OUT, `${JSON.stringify({ generatedAt: meta.generatedAt, source: "relay content-candidates", symbols }, null, 1)}\n`);
  console.log(`wrote ${OUT}: ${symbols.length} symbols (pool ${meta.pool}, universe ${meta.universe}, with SEC facts ${meta.withFacts}; ${meta.commands} Redis commands, read-only)`);
}
