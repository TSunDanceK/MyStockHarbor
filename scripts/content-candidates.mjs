// THE CONTENT CANDIDATES (#563 COWORK #182/#183): which stocks new bottleneck
// maps and insight posts may be picked from. The owner's rule: in the price
// universe AND with SEC data on file, so every panel on the page fills.
//
// TWO MODES, because the census needs Redis and the sandbox has none:
//
//   1. On the relay runner (relay task write-content-candidates; READ-ONLY
//      despite the prefix, which only routes it to the job holding the Upstash
//      credentials). One row per pool symbol is printed as a compact `CC|…` log
//      line, plus a `CCSUM|…` line that mode 2 checks every row against.
//        Redis: 1 HKEYS (price pool) + 1 HGETALL (Tiingo eod-last, the live
//        close) + 1 GET (Pickers universe) + 1 HMGET
//        (SEC picker rows) + 1-2 GET per symbol (its stored fact set). No
//        writes: the pool, the SEC rows and the fact sets are read directly,
//        not through their metered readers (whose meters write). No SEC
//        requests, no FMP.
//
//   2. Locally: `node scripts/content-candidates.mjs --from-log <task.log>`
//      rebuilds data/content-candidates.json from those lines, recomputing
//      hasBottleneck and latestInsightDate from content/ (the schedules do the
//      same), then prints the two top-40 tables and the thin pages.
//
// THE COLUMNS. inPool: a live close (Tiingo's newest stored bar, the last 7 days). hasSecFacts: a stored
// fact set that A's buildSecEarningsView builds without error (imported, not
// copied). thinFilings: most of the latest quarter's growth/margin figures are
// n/m under A's rule (#552 COWORK #212: the view's own markers). marketCap:
// price x SEC cover-page shares (secValuation.marketCap, the Pickers' figure),
// to the nearest $1M, or null when SEC refuses it. sector: the committed SIC profile (sectorOf) and
// name: the committed name snapshot, both added in mode 2 (they read committed
// files only, and their @/ imports need the render hooks).
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
  const { SEC_FACTS_PREFIX, dotDashSpellings } = await import("../lib/server/secManifest.ts");
  const { secFieldsHash } = await import("../lib/server/secFields.ts");
  const { pickersSecKey } = await import("../lib/server/pickersSecFundamentals.ts");
  const { PRICE_POOL_KEY } = await import("../lib/server/pricePool.ts");
  const { TIINGO_EOD_LAST_KEY } = await import("../lib/server/marketData/keys.ts");
  // pickersBuilder.PICKERS_SYMBOLS_KEY. Named here, as pickers-marketcap-census
  // does, because that module's @/ imports do not resolve under the relay's
  // loader; check-content-candidates asserts the two agree.
  const PICKERS_SYMBOLS_KEY = "msh:pickers:v10:symbols";
  const redis = Redis.fromEnv();
  let commands = 0;

  // THE LIVE CLOSE is Tiingo's newest stored bar (eod-last, the hash every pool
  // reader overlays at read time): the FMP pool rows themselves no longer carry
  // a price. Read directly, not through readPricePoolBulk, whose meter writes.
  const poolKeys = ((await redis.hkeys(PRICE_POOL_KEY)) ?? []).map((k) => String(k).toUpperCase()); commands++;
  const eodRaw = (await redis.hgetall(TIINGO_EOD_LAST_KEY)) ?? {}; commands++;
  const uniRaw = await redis.get(PICKERS_SYMBOLS_KEY); commands++;
  const uniList = Array.isArray(uniRaw) ? uniRaw : Array.isArray(uniRaw?.symbols) ? uniRaw.symbols : [];
  const universe = new Set(uniList.map((x) => String(typeof x === "string" ? x : x?.symbol ?? "").toUpperCase()).filter(Boolean));
  const eod = new Map();
  for (const [k, v] of Object.entries(eodRaw)) {
    let r = v;
    if (typeof r === "string") try { r = JSON.parse(r); } catch { r = null; }
    if (r && typeof r === "object") eod.set(k.toUpperCase(), r);
  }
  // Live: a close from the last 7 calendar days (a long weekend and a holiday).
  const liveSince = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  const closeOf = (s) => {
    const r = eod.get(s) ?? eod.get(s.replace(/\./g, "-")) ?? eod.get(s.replace(/-/g, "."));
    return r && typeof r.c === "number" && r.c > 0 && typeof r.d === "string" && r.d >= liveSince ? r.c : null;
  };
  const pool = new Set(poolKeys);
  const symbols = [...new Set([...poolKeys, ...universe])].sort();
  const secRaw = symbols.length ? await redis.hmget(pickersSecKey({}), ...symbols) : []; commands++;
  const secRow = new Map(symbols.map((s, i) => [s, Array.isArray(secRaw) ? secRaw[i] : secRaw?.[s] ?? null]));

  let withFacts = 0;
  const rows = [];
  for (const symbol of symbols) {
    const price = closeOf(symbol);
    let set = null, view = null;
    // THE STORED FACT SET, read as secFactStore.readFactSet reads it (either
    // spelling; a field-order mismatch is a miss) but without its bandwidth
    // meter, which writes (#552 COWORK #213): this census stays read-only.
    for (const spelling of dotDashSpellings(symbol)) {
      let raw = null;
      try { raw = await redis.get(`${SEC_FACTS_PREFIX}:${spelling.toUpperCase()}`); } catch { raw = null; }
      commands++;
      if (raw && typeof raw === "object") { set = raw.h === secFieldsHash() && Array.isArray(raw.quarters) ? raw : null; break; }
    }
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
      // In $M: the log is copied off the runner by hand-checked transcription (the
      // sandbox cannot reach the artifact host), so the rows are kept short and
      // CCSUM below lets mode 2 verify every one of them.
      if (fig?.ok && typeof fig.val === "number") cap = Math.round(fig.val / 1e6);
    }
    rows.push([symbol, cap ?? "", price !== null ? 1 : 0, view ? 1 : 0, nmCount, figures]);
  }
  for (const r of rows) console.log(`CC|${r.join("|")}`);
  const capSum = rows.reduce((a, r) => a + (r[1] === "" ? 0 : r[1]), 0);
  const nmSum = rows.reduce((a, r) => a + r[4] * 7 + r[5], 0);
  console.log(`CCSUM|${rows.length}|${capSum}|${rows.filter((r) => r[2]).length}|${withFacts}|${nmSum}|${new Date().toISOString()}|${pool.size}|${universe.size}|${commands}`);
  console.log(`Redis commands: ${commands} (read-only: HKEYS, HGETALL, GET, HMGET)`);
} else {
  // ── MODE 2: LOCAL, FROM THE RUN'S LOG ─────────────────────────────────────
  // The name and the sector need the app's @/ imports: the render hooks resolve them.
  const { register } = await import("node:module");
  register("./lib/tsx-render-hooks.mjs", import.meta.url);
  const { sectorOf } = await import("../lib/server/sectorOf.ts");
  const { snapshotCompanyName } = await import("../lib/server/companyNameSnapshot.ts");
  const { normaliseCompanyName } = await import("../lib/server/news/companyName.ts");
  const log = fs.readFileSync(process.argv[fromLog + 1], "utf8");
  const rows = [...log.matchAll(/^(?:\S+ )?CC\|([^|\n]+)\|(\d*)\|([01])\|([01])\|(\d+)\|(\d+)\s*$/gm)].map((m) => ({
    symbol: m[1], marketCap: m[2] === "" ? null : Number(m[2]) * 1e6, inPool: m[3] === "1", hasSecFacts: m[4] === "1", nmCount: Number(m[5]), figures: Number(m[6]),
  }));
  const sum = /CCSUM\|(\d+)\|(\d+)\|(\d+)\|(\d+)\|(\d+)\|([^|]+)\|(\d+)\|(\d+)\|(\d+)/.exec(log);
  if (!rows.length || !sum) { console.error("no CC / CCSUM lines in the log"); process.exit(1); }
  // EVERY ROW VERIFIED against the runner's own totals before anything is written.
  const got = [rows.length, rows.reduce((a, r) => a + (r.marketCap ?? 0) / 1e6, 0), rows.filter((r) => r.inPool).length, rows.filter((r) => r.hasSecFacts).length, rows.reduce((a, r) => a + r.nmCount * 7 + r.figures, 0)];
  const want = sum.slice(1, 6).map(Number);
  if (got.some((v, i) => Math.round(v) !== want[i]) || new Set(rows.map((r) => r.symbol)).size !== rows.length) {
    console.error(`checksum mismatch: got ${got.join("/")}, runner said ${want.join("/")}`); process.exit(1);
  }
  const meta = { generatedAt: sum[6], pool: Number(sum[7]), universe: Number(sum[8]), withFacts: want[3], commands: Number(sum[9]) };
  const { bn, latest } = contentFlags();
  const symbols = rows.map((r) => ({
    symbol: r.symbol,
    name: normaliseCompanyName(snapshotCompanyName(r.symbol)) || r.symbol,
    sector: sectorOf(r.symbol)?.name ?? null,
    marketCap: r.marketCap,
    inPool: r.inPool,
    hasSecFacts: r.hasSecFacts,
    // Most of the latest quarter's growth/margin figures n/m (A's rule).
    thinFilings: r.figures > 0 && r.nmCount * 2 > r.figures,
    hasBottleneck: bn.has(r.symbol),
    latestInsightDate: latest.get(r.symbol) ?? null,
  })).sort((a, b) => (b.marketCap ?? -1) - (a.marketCap ?? -1) || a.symbol.localeCompare(b.symbol));
  fs.writeFileSync(OUT, `${JSON.stringify({ generatedAt: meta.generatedAt, source: "relay content-candidates", symbols }, null, 1)}\n`);
  console.log(`wrote ${OUT}: ${symbols.length} symbols (pool ${meta.pool}, universe ${meta.universe}, with SEC facts ${meta.withFacts}; ${meta.commands} Redis commands, read-only)`);
}
