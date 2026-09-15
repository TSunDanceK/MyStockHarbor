// PHASE 0 of claude/BRIEF-logo-harvest-2026-09-14.md: does FMP's image CDN
// actually hold a logo for this site's universe? PROBE ONLY -- this fetches
// headers and image prefixes, and writes nothing into the repo.
//
// WHY IT RUNS ON A RUNNER. images.financialmodelingprep.com is refused by the
// agent egress policy with 403 CONNECT, re-confirmed 2026-09-14 alongside the
// API host. The image CDN needs NO credential, so this is purely a reachability
// problem -- which is why it is a read-only, unprefixed relay task in the job
// that references no secrets, and why the no-FMP-key-in-Actions constraint is
// never in play. See app/api/debug/static-profile/README.md.
//
// NODE BUILTINS AND GLOBAL FETCH ONLY. The read-only relay job deliberately runs
// no `npm ci`, so it cannot reach Redis even by accident. An import from
// node_modules here would break that job at run time.
//
// ── THE UNIVERSE IS A UNION, AND THE "~700" FIGURE WAS WRONG ──────────────
// The brief's original ~700 traced to readPickersSymbolsIfCached() -- the
// pickers cache in Redis, sized for FMP call pacing. That is not the logo
// universe, and it is unreadable from here anyway (no Upstash credentials in
// this job, by design). Per constraint 6 the candidate set is the union of:
//
//   data/company-names.json   2,592  Nasdaq symdir snapshot
//   data/static-profile.json  2,619  sector/industry only
//   lib/curatedSymbols.ts       161  sitemap + "Explore More Stocks";
//                                    33 of these are in NEITHER file, and are
//                                    nearly every major ETF the site links
//                                    (SPY, QQQ, XL*, GLD, TLT...). TickerLogo
//                                    renders them today.
//
// Symdir is ALSO fetched live, because it is the only source carrying Exchange
// and an ETF flag -- `exchange` sits in static-profile.json's
// absentFields.blocked, so the brief's requested splits cannot come from
// committed data.
import fs from "node:fs";
import { symbolSpellings } from "./lib/symbol-spellings.mjs";

const UA =
  process.env.PROBE_USER_AGENT ??
  "MyStockHarbor/1.0 (+https://www.mystockharbor.com; logo coverage probe)";
const CONCURRENCY = Number(process.env.PROBE_CONCURRENCY ?? 8);
const PLACEHOLDER_MAX_BYTES = Number(process.env.PROBE_PLACEHOLDER_BYTES ?? 200);
const LIMIT = Number(process.env.PROBE_LIMIT ?? 0); // 0 = no cap; >0 for smoke runs
const PREFIX_BYTES = 4095;

const NASDAQ_LISTED_URL = "https://www.nasdaqtrader.com/dynamic/symdir/nasdaqlisted.txt";
const OTHER_LISTED_URL = "https://www.nasdaqtrader.com/dynamic/symdir/otherlisted.txt";

// otherlisted.txt's single-letter Exchange codes, per the file's own legend.
const EXCHANGE_NAMES = { A: "NYSE American", N: "NYSE", P: "NYSE Arca", Z: "Cboe BZX", V: "IEX" };

// ── HEADER-DRIVEN PARSE, LOCAL TO THIS PROBE ──────────────────────────────
// scripts/lib/nasdaq-directory.mjs parses these same files but keeps only
// symbol/name -- it drops Exchange and ETF, the two columns this probe splits
// on. Rather than widen a shared module during a probe-only phase, the extra
// columns are read here using the discipline that module documents: BY HEADER
// NAME, never by position. Position happens to work for these two files and
// silently misreads nasdaqtraded.txt, whose symbol sits at index 1.
function parseDirectory(text, { defaultExchange }) {
  if (typeof text !== "string" || !text.trim()) return [];
  const lines = text.split("\n").map((l) => l.replace(/\r$/, "")).filter((l) => l.trim());
  if (!lines.length) return [];

  const header = lines[0].split("|").map((h) => h.trim());
  const iSymbol = header.findIndex((h) => h === "Symbol" || h === "ACT Symbol");
  const iName = header.indexOf("Security Name");
  const iTest = header.indexOf("Test Issue");
  const iEtf = header.indexOf("ETF");
  const iExch = header.indexOf("Exchange");
  const iAlt = header.indexOf("NASDAQ Symbol");
  // NO POSITIONAL FALLBACK. An unrecognised header means unknown columns, and
  // guessing 0/1 is how a Y/N flag becomes a ticker. Empty is the honest answer,
  // and the caller treats empty as an outage.
  if (iSymbol < 0 || iName < 0) return [];

  const out = [];
  for (const line of lines.slice(1)) {
    const f = line.split("|");
    if (f.length < header.length) continue;               // trailing "File Creation Time"
    if (iTest >= 0 && f[iTest]?.trim() === "Y") continue; // deliberate fake rows (ZZZZZ)
    const symbol = (f[iSymbol] ?? "").trim().toUpperCase();
    if (!symbol) continue;
    const exchCode = iExch >= 0 ? (f[iExch] ?? "").trim().toUpperCase() : "";
    out.push({
      symbol,
      name: (f[iName] ?? "").trim(),
      exchange: exchCode ? (EXCHANGE_NAMES[exchCode] ?? `code ${exchCode}`) : defaultExchange,
      isEtf: (iEtf >= 0 ? (f[iEtf] ?? "").trim().toUpperCase() : "") === "Y",
      altSymbol: iAlt >= 0 ? (f[iAlt] ?? "").trim().toUpperCase() : "",
    });
  }
  return out;
}

async function getText(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.text();
}

// ── PNG DIMENSIONS OUT OF THE FIRST BYTES ─────────────────────────────────
// WHY THIS IS HERE AND NOT LEFT TO PHASE 2. The brief's storage thresholds
// (~10 MB -> public/, ~25 MB -> separate repo) are about the TRANSCODED WebP at
// 64/128px, but the only figure Phase 0 can measure directly is the RAW PNG
// total -- and the two differ by a large, unknown factor that depends entirely
// on how big the sources are. Reporting the raw total alone would invite
// applying a WebP threshold to a PNG number and picking the wrong home.
// Source dimensions make the gap estimable, and a ranged GET carries the IHDR
// in bytes it is already transferring, so this costs no extra request.
function pngDimensions(bytes) {
  if (!bytes || bytes.length < 24) return null;
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i += 1) if (bytes[i] !== sig[i]) return null;
  if (String.fromCharCode(...bytes.slice(12, 16)) !== "IHDR") return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

// ── ONE SYMBOL ────────────────────────────────────────────────────────────
// A RANGED GET IS THE PRIMARY METHOD, not HEAD. HEAD is one byte cheaper and
// answers strictly less: Content-Range gives the full size just as
// Content-Length would, and the prefix body carries the IHDR that sizes Phase 2.
// A server that ignores Range answers 200 with the whole body, which is still
// measurable; only a 416 needs the plain-GET fallback.
//
// A 200 UNDER ~200 BYTES IS A MISS, not a hit -- that is placeholder/1x1
// territory, and committing those would put blank chips on the site while the
// manifest claimed a logo existed.
async function probe(symbol) {
  const url = `https://images.financialmodelingprep.com/symbol/${encodeURIComponent(symbol)}.png`;
  const started = Date.now();
  try {
    let res = await fetch(url, {
      headers: { "User-Agent": UA, Range: `bytes=0-${PREFIX_BYTES}` },
      redirect: "follow",
    });
    let method = "GET/range";
    if (res.status === 416) {
      res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" });
      method = "GET/full";
    }

    const status = res.status;
    const ms = Date.now() - started;
    const ct = res.headers.get("content-type") ?? "";

    if (status === 429)
      return { symbol, status, ms, method, bytes: null, dims: null, verdict: "rate-limited", retryAfter: res.headers.get("retry-after") ?? "", ct };
    if (!res.ok)
      return { symbol, status, ms, method, bytes: null, dims: null, verdict: "miss", ct };

    const body = new Uint8Array(await res.arrayBuffer());
    // 206 -> Content-Range's trailing total is authoritative. 200 -> the server
    // ignored Range and the body IS the whole file.
    const cr = res.headers.get("content-range");
    const m = cr && /\/(\d+)\s*$/.exec(cr);
    const bytes = m ? Number(m[1]) : body.length;
    const dims = pngDimensions(body);

    if (bytes <= PLACEHOLDER_MAX_BYTES)
      return { symbol, status, ms, method, bytes, dims, verdict: "placeholder", ct };
    return { symbol, status, ms, method, bytes, dims, verdict: "hit", ct };
  } catch (err) {
    return { symbol, status: 0, ms: Date.now() - started, method: "ERR", bytes: null, dims: null, verdict: "error", err: String(err?.message ?? err) };
  }
}

async function runPool(items, worker, size) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await worker(items[i], i);
      }
    })
  );
  return out;
}

const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : "n/a");
const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;
const quantile = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] : null);

// ── BUILD THE UNIVERSE ────────────────────────────────────────────────────
console.log("LOGO COVERAGE PROBE — FMP image CDN · Phase 0 of the logo-harvest brief");
console.log(`User-Agent: ${UA}`);
console.log(`concurrency: ${CONCURRENCY} · placeholder threshold: <=${PLACEHOLDER_MAX_BYTES} bytes\n`);

const [nasdaqTxt, otherTxt] = await Promise.all([getText(NASDAQ_LISTED_URL), getText(OTHER_LISTED_URL)]);
const nasdaqRows = parseDirectory(nasdaqTxt, { defaultExchange: "Nasdaq" });
const otherRows = parseDirectory(otherTxt, { defaultExchange: "(other)" });
// parseDirectory returns [] for anything that is not a pipe file -- including a
// 200 carrying an HTML outage page. Empty is failure, not "no rows today".
if (!nasdaqRows.length || !otherRows.length) {
  console.error("FATAL: a symdir file parsed to zero rows — treat as an outage, not as an empty directory.");
  process.exit(1);
}

const meta = new Map();
for (const r of [...nasdaqRows, ...otherRows]) if (!meta.has(r.symbol)) meta.set(r.symbol, r);

const companyNames = JSON.parse(fs.readFileSync("data/company-names.json", "utf8"));
const cnSymbols = Object.keys(companyNames.rows);
const staticProfile = JSON.parse(fs.readFileSync("data/static-profile.json", "utf8"));
const spSymbols = Object.keys(staticProfile.rows);
const curatedSrc = fs.readFileSync("lib/curatedSymbols.ts", "utf8");
const curated = [...new Set([...curatedSrc.matchAll(/"([A-Z][A-Z0-9.\-]{0,6})"/g)].map((m) => m[1]))];

// FIRST WRITER WINS, and the order is deliberate: a symbol's reported source is
// the broadest list it appears in, so "curated" in the split below means
// curated-ONLY -- the 33 the committed files miss, which is the slice worth
// watching.
const origin = new Map();
const note = (sym, src) => { if (!origin.has(sym)) origin.set(sym, src); };
for (const s of cnSymbols) note(s, "company-names");
for (const s of spSymbols) note(s, "static-profile");
for (const s of curated) note(s, "curated-only");

let symbols = [...origin.keys()].sort();
if (LIMIT > 0) symbols = symbols.slice(0, LIMIT);

console.log("UNIVERSE (constraint 6)");
console.log(`  data/company-names.json : ${cnSymbols.length}`);
console.log(`  data/static-profile.json: ${spSymbols.length}`);
console.log(`  lib/curatedSymbols.ts   : ${curated.length}  (${curated.filter((s) => !cnSymbols.includes(s) && !spSymbols.includes(s)).length} in neither file)`);
console.log(`  symdir nasdaqlisted     : ${nasdaqRows.length}   (live, for Exchange + ETF flags)`);
console.log(`  symdir otherlisted      : ${otherRows.length}`);
console.log(`  PROBED (union)          : ${symbols.length}${LIMIT ? ` (capped at ${LIMIT})` : ""}\n`);

// ── PROBE ─────────────────────────────────────────────────────────────────
const t0 = Date.now();
const results = await runPool(symbols, (s) => probe(s), CONCURRENCY);
const wall = (Date.now() - t0) / 1000;

const by = (v) => results.filter((r) => r.verdict === v);
const hits = by("hit");
const placeholders = by("placeholder");
const misses = by("miss");
const limited = by("rate-limited");
const errors = by("error");
const probed = results.length;
// Placeholders are misses for coverage: the brief defines a sub-200-byte 200 as
// a miss, and Phase 2 must not harvest them.
const effectiveMisses = misses.length + placeholders.length;

console.log("HEADLINE");
console.log(`  probed        : ${probed}`);
console.log(`  hits          : ${hits.length}  (${pct(hits.length, probed)})`);
console.log(`  misses        : ${effectiveMisses}  (${pct(effectiveMisses, probed)})  [${misses.length} non-200 + ${placeholders.length} placeholder]`);
console.log(`  rate-limited  : ${limited.length}`);
console.log(`  errors        : ${errors.length}`);
console.log(`  wall-clock    : ${wall.toFixed(1)}s\n`);

const statuses = {};
for (const r of results) statuses[r.status] = (statuses[r.status] ?? 0) + 1;
console.log(`STATUS HISTOGRAM: ${JSON.stringify(statuses)}`);
if (limited.length) {
  console.log(`  429s SEEN — Retry-After samples: ${limited.slice(0, 5).map((r) => r.retryAfter || "(none)").join(", ")}`);
  console.log("  A non-zero 429 count makes the Phase 2 harvest a paced job, not a burst.");
} else {
  console.log(`  No 429s observed at concurrency ${CONCURRENCY}.`);
}
if (errors.length) console.log(`  error samples: ${errors.slice(0, 3).map((r) => `${r.symbol}: ${r.err}`).join(" · ")}`);
console.log();

// ── THE FIGURE THAT DECIDES WHERE THE FILES LIVE ──────────────────────────
const sizes = hits.map((r) => r.bytes).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
const rawTotal = sizes.reduce((a, b) => a + b, 0);
console.log("HIT BYTE-SIZE DISTRIBUTION (raw PNG, as served)");
if (sizes.length) {
  console.log(`  min ${sizes[0]} · p25 ${quantile(sizes, 0.25)} · median ${quantile(sizes, 0.5)} · p75 ${quantile(sizes, 0.75)} · max ${sizes[sizes.length - 1]} bytes`);
  console.log(`  RAW PNG TOTAL FOR ALL HITS: ${mb(rawTotal)} across ${sizes.length} hits`);
} else {
  console.log("  no sized hits");
}
console.log();

// Dimensions turn the raw total into something the WebP thresholds can be
// applied to. A source already at or below 128px will barely shrink; a 600px
// source transcoded to 128px shrinks by roughly the square of the ratio.
const dimmed = hits.filter((r) => r.dims);
console.log("SOURCE DIMENSIONS (from IHDR, same bytes the ranged GET already fetched)");
if (dimmed.length) {
  const widths = dimmed.map((r) => r.dims.width).sort((a, b) => a - b);
  const buckets = {};
  for (const r of dimmed) {
    const w = r.dims.width;
    const k = w <= 64 ? "<=64px" : w <= 128 ? "65-128px" : w <= 256 ? "129-256px" : w <= 512 ? "257-512px" : ">512px";
    buckets[k] = (buckets[k] ?? 0) + 1;
  }
  console.log(`  parsed ${dimmed.length}/${hits.length} hits · width min ${widths[0]} · median ${quantile(widths, 0.5)} · max ${widths[widths.length - 1]}`);
  console.log(`  width buckets: ${JSON.stringify(buckets)}`);
  const medianW = quantile(widths, 0.5) || 1;
  const ratio = Math.min(1, 128 / medianW) ** 2;
  console.log(`  ROUGH Phase 2 projection: WebP at 64+128px is area-bound, so expect well under`);
  console.log(`  the raw total — order of ${mb(rawTotal * ratio * 1.25)} for both sizes combined at the`);
  console.log(`  median width, and WebP compresses better than PNG on flat logo art.`);
  console.log(`  TREAT AS AN ORDER OF MAGNITUDE, NOT A BUDGET — only a real sharp pass settles it.`);
} else {
  console.log("  no IHDR parsed — sources may not be PNG; report before assuming sizes");
}
console.log();

function split(label, keyOf) {
  const groups = new Map();
  for (const r of results) {
    const k = keyOf(r.symbol);
    if (k == null) continue;
    if (!groups.has(k)) groups.set(k, { hit: 0, total: 0 });
    const g = groups.get(k);
    g.total += 1;
    if (r.verdict === "hit") g.hit += 1;
  }
  console.log(label);
  for (const [k, g] of [...groups.entries()].sort((a, b) => b[1].total - a[1].total)) {
    console.log(`  ${String(k).padEnd(24)} ${String(g.hit).padStart(5)}/${String(g.total).padEnd(6)} ${pct(g.hit, g.total)}`);
  }
  console.log();
}

split("HIT RATE BY EXCHANGE", (s) => meta.get(s)?.exchange ?? "(not in symdir)");
split("HIT RATE BY INSTRUMENT", (s) => {
  const m = meta.get(s);
  if (!m) return "(not in symdir)";
  return m.isEtf ? "ETF / fund" : "operating company";
});
split("HIT RATE BY SOURCE SLICE", (s) => origin.get(s) ?? "?");

// ── NAMED MISSES ──────────────────────────────────────────────────────────
// 20 NAMED, so the owner can eyeball whether the tail is muni closed-end funds
// (monogram is the honest answer) or real companies (a gap-filler is warranted).
// Names come from symdir so the list is readable without a second lookup.
const namedMisses = [...misses, ...placeholders].slice(0, 20);
console.log(`20 NAMED MISSES (of ${effectiveMisses})`);
for (const r of namedMisses) {
  const m = meta.get(r.symbol);
  console.log(
    `  ${r.symbol.padEnd(8)} ${String(r.status).padEnd(4)} ${(m ? (m.isEtf ? "ETF" : "co") : "?").padEnd(4)} ${(m?.exchange ?? "-").padEnd(16)} ${(m?.name ?? "(not in symdir)").slice(0, 58)}`
  );
}
console.log();

// ── DOT/DASH SPELLING ─────────────────────────────────────────────────────
// BRK.B vs BRK-B has already cost this repo a CIK lookup. If the CDN keys on one
// spelling only, a harvest built from the other silently loses those names, so
// the question is settled here rather than discovered in Phase 2.
const dotted = symbols.filter((s) => s.includes("."));
console.log(`DOT vs DASH SPELLING (${dotted.length} dotted symbols in the union)`);
if (dotted.length) {
  // symbolSpellings' first alternate is the dash form. Through the helper so a
  // new spelling rule reaches this probe too.
  const alt = await runPool(dotted, (s) => probe(symbolSpellings(s)[1] ?? s), CONCURRENCY);
  const dottedRes = new Map(results.map((r) => [r.symbol, r]));
  for (let i = 0; i < alt.length; i += 1) {
    const d = dotted[i];
    console.log(`  ${d.padEnd(8)} dotted=${String(dottedRes.get(d)?.verdict ?? "?").padEnd(12)} dashed=${alt[i].verdict}`);
  }
} else {
  console.log("  none");
}
console.log();

// FULL RESULTS INTO THE LOG, deliberately. relay.yml's upload globs are a fixed
// list on main and none match a new filename, so a JSON file written here would
// be silently discarded -- the exact failure its own comment records for the
// company-tickers task. task.log IS uploaded, so the log is the artifact.
console.log("FULL RESULTS (TSV: symbol\tverdict\tstatus\tbytes\twidth)");
for (const r of results) console.log(`${r.symbol}\t${r.verdict}\t${r.status}\t${r.bytes ?? ""}\t${r.dims?.width ?? ""}`);
